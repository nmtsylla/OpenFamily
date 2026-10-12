#!/usr/bin/env bash
set -euo pipefail

API_BASE="${API_BASE:-http://localhost:3001}"
RUN_ID="${RUN_ID:-$(date +%s)-$RANDOM}"
EMAIL="${SMOKE_EMAIL:-smoke-${RUN_ID}@example.com}"
PASSWORD="${SMOKE_PASSWORD:-SmokeTest123!}"
NAME="${SMOKE_NAME:-Smoke ${RUN_ID}}"
TOKEN=""

request() {
  local method="$1"
  local path="$2"
  local body="${3:-}"

  local tmp
  tmp="$(mktemp)"

  if [[ -n "$body" ]]; then
    code=$(curl -sS -o "$tmp" -w "%{http_code}" -X "$method" "$API_BASE$path" \
      -H "Content-Type: application/json" \
      ${TOKEN:+-H "Authorization: Bearer $TOKEN"} \
      -d "$body")
  else
    code=$(curl -sS -o "$tmp" -w "%{http_code}" -X "$method" "$API_BASE$path" \
      -H "Content-Type: application/json" \
      ${TOKEN:+-H "Authorization: Bearer $TOKEN"})
  fi

  BODY="$(cat "$tmp")"
  rm -f "$tmp"

  if [[ "$code" -lt 200 || "$code" -ge 300 ]]; then
    echo "[FAIL] $method $path -> HTTP $code"
    echo "$BODY"
    exit 1
  fi

  echo "$BODY"
}

assert_success() {
  echo "$1" | jq -e '.success == true' >/dev/null
}

echo "[1/12] Health"
health=$(request GET "/health")
echo "$health" | jq -e '.status == "ok"' >/dev/null

echo "[2/12] Register"
reg=$(request POST "/api/auth/register" "{\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\",\"name\":\"$NAME\"}")
assert_success "$reg"
TOKEN=$(echo "$reg" | jq -r '.data.token')

if [[ "$TOKEN" == "null" || -z "$TOKEN" ]]; then
  echo "[FAIL] Missing auth token"
  exit 1
fi

echo "[3/12] Family"
member=$(request POST "/api/family" '{"name":"Alice","role":"Parent","color":"#FF4466","birthdate":"1990-01-01","allergies":["Pollen"],"medications":["Vitamin C"],"emergency_contact_name":"Bob","emergency_contact_phone":"+33123456789","notes":"RAS"}')
assert_success "$member"
FAMILY_ID=$(echo "$member" | jq -r '.data.id')

request PUT "/api/family/$FAMILY_ID" '{"name":"Alice Martin","notes":"Note maj"}' >/dev/null
request GET "/api/family" >/dev/null

echo "[4/12] Shopping"
item=$(request POST "/api/shopping" '{"name":"Lait","category":"Alimentation","quantity":2,"price":1.5,"unit":"L"}')
assert_success "$item"
SHOP_ID=$(echo "$item" | jq -r '.data.id')
request PUT "/api/shopping/$SHOP_ID" '{"is_checked":true}' >/dev/null

tpl=$(request POST "/api/shopping/templates" '{"name":"Template Semaine","items":[{"name":"Pain","category":"Alimentation","quantity":1}]}')
assert_success "$tpl"
TPL_ID=$(echo "$tpl" | jq -r '.data.id')
request POST "/api/shopping/templates/$TPL_ID/apply" '{}' >/dev/null
request DELETE "/api/shopping/checked/clear" >/dev/null
request DELETE "/api/shopping/templates/$TPL_ID" >/dev/null

echo "[5/12] Tasks"
task=$(request POST "/api/tasks" "{\"title\":\"Sortir les poubelles\",\"priority\":\"Haute\",\"assigned_to\":\"$FAMILY_ID\"}")
assert_success "$task"
TASK_ID=$(echo "$task" | jq -r '.data.id')
request PUT "/api/tasks/$TASK_ID" '{"is_completed":true}' >/dev/null
request GET "/api/tasks/statistics" >/dev/null

echo "[6/12] Appointments"
apt=$(request POST "/api/appointments" "{\"title\":\"Dentiste\",\"start_time\":\"2026-03-10T09:00:00.000Z\",\"family_member_id\":\"$FAMILY_ID\",\"reminder_30min\":true}")
assert_success "$apt"
APPOINTMENT_ID=$(echo "$apt" | jq -r '.data.id')
request PUT "/api/appointments/$APPOINTMENT_ID" '{"location":"Cabinet Centre"}' >/dev/null
request GET "/api/appointments?start_date=2026-03-01T00:00:00.000Z&end_date=2026-03-31T23:59:59.000Z" >/dev/null

# The iCal feed is read by Google, Apple and Outlook without a session: it must
# answer with the calendar, not 401 (1.8.0 broke it).
FEED_TOKEN=$(request GET "/api/calendar/token" | jq -r '.data.token')
feed_status=$(curl -sS -o /tmp/openfamily-feed.ics -w '%{http_code}' "$API_BASE/api/calendar/$FEED_TOKEN/openfamily.ics")
if [ "$feed_status" != "200" ] || ! grep -q "SUMMARY:Dentiste" /tmp/openfamily-feed.ics; then
  echo "[FAIL] iCal feed answered $feed_status without the appointment" >&2
  exit 1
fi

echo "[7/12] Planning"
planning=$(request POST "/api/planning" "{\"family_member_id\":\"$FAMILY_ID\",\"schedule_type\":\"work\",\"title\":\"Bureau\",\"day_of_week\":1,\"start_time\":\"09:00\",\"end_time\":\"17:00\"}")
assert_success "$planning"
PLANNING_ID=$(echo "$planning" | jq -r '.data.id')
request PUT "/api/planning/$PLANNING_ID" '{"location":"Open Space"}' >/dev/null
request GET "/api/planning?day_of_week=1" >/dev/null
planning_bulk=$(request POST "/api/planning/bulk" "{\"family_member_id\":\"$FAMILY_ID\",\"schedule_type\":\"work\",\"title\":\"Bureau\",\"day_of_week_list\":[2,3],\"start_time\":\"09:00\",\"end_time\":\"17:00\",\"replace_conflicts\":true}")
assert_success "$planning_bulk"

echo "[8/12] Recipes"
recipe=$(request POST "/api/recipes" '{"name":"Pasta","category":"Plat","ingredients":["Pates","Sel"],"instructions":["Cuire","Servir"],"difficulty":"Facile"}')
assert_success "$recipe"
RECIPE_ID=$(echo "$recipe" | jq -r '.data.id')
request PUT "/api/recipes/$RECIPE_ID" '{"description":"Recette test"}' >/dev/null
request GET "/api/recipes" >/dev/null

echo "[9/12] Meal Plans"
meal=$(request POST "/api/meal-plans" "{\"date\":\"2026-03-12\",\"meal_type\":\"Dejeuner\",\"recipe_id\":\"$RECIPE_ID\"}")
assert_success "$meal"
MEAL_ID=$(echo "$meal" | jq -r '.data.id')
request PUT "/api/meal-plans/$MEAL_ID" '{"notes":"Repas famille"}' >/dev/null
request GET "/api/meal-plans?start_date=2026-03-10&end_date=2026-03-20" >/dev/null

echo "[10/12] Budget"
budget=$(request POST "/api/budget/entries" '{"category":"Alimentation","amount":25.5,"date":"2026-03-11","is_expense":true}')
assert_success "$budget"
BUDGET_ID=$(echo "$budget" | jq -r '.data.id')
request PUT "/api/budget/entries/$BUDGET_ID" '{"description":"Courses semaine"}' >/dev/null
request POST "/api/budget/limits" '{"category":"Alimentation","monthly_limit":300,"month":3,"year":2026}' >/dev/null
request GET "/api/budget/statistics?month=3&year=2026" >/dev/null

# FORK-START: budget-custom
# Receipt import: a parent reaches the route (no AI configured here → 400), and a
# 2 MB body is parsed INSIDE the router. A 413 would mean the default 1 MB parser,
# registered before authentication, swallowed the body instead. The payload goes
# through a file: a single shell argument is capped at 128 KB.
printf '{"files":[{"name":"ticket.png","mime_type":"image/png","data":"' > /tmp/openfamily-receipt-request.json
head -c 2000000 /dev/zero | tr '\0' 'A' >> /tmp/openfamily-receipt-request.json
printf '"}]}' >> /tmp/openfamily-receipt-request.json
receipt_status=$(curl -sS -o /tmp/openfamily-receipt.json -w '%{http_code}' -X POST "$API_BASE/api/ai/extract-receipt" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  --data-binary @/tmp/openfamily-receipt-request.json)
rm -f /tmp/openfamily-receipt-request.json
if [ "$receipt_status" != "400" ] || ! grep -q 'AI_NOT_CONFIGURED' /tmp/openfamily-receipt.json; then
  echo "[FAIL] POST /api/ai/extract-receipt answered $receipt_status instead of reaching the route" >&2
  cat /tmp/openfamily-receipt.json >&2
  exit 1
fi

# Receipts live on their own router under /api/budget, mounted before it: the
# list must answer (empty for a fresh family) rather than fall into the budget
# router's prefix and 404.
receipts=$(request GET "/api/budget/receipts")
echo "$receipts" | jq -e '.data | length == 0' >/dev/null

# Budget analytics: its own router under /api/budget-analytics; a well-formed
# overview for the period (empty family → zeroed totals).
analytics=$(request GET "/api/budget-analytics/overview?start=2026-03-01&end=2026-03-31")
echo "$analytics" | jq -e '.data.totals | has("expenses")' >/dev/null
# FORK-END: budget-custom

# FORK-START: lunchbox
# Lunchboxes live in their own table and router (/api/lunchbox): create one for
# the family member, check it comes back in the week, that the stats aggregate it,
# and that the shopping list picks its components up.
lunchbox=$(request POST "/api/lunchbox" "{\"date\":\"2026-03-11\",\"family_member_id\":\"$FAMILY_ID\",\"items\":{\"main\":\"Sandwich\",\"fruit\":\"Pomme\",\"drink\":\"Eau\"},\"notes\":\"Sortie scolaire\"}")
assert_success "$lunchbox"
LUNCHBOX_ID=$(echo "$lunchbox" | jq -r '.data.id')

week=$(request GET "/api/lunchbox?start_date=2026-03-09&end_date=2026-03-15")
echo "$week" | jq -e --arg id "$LUNCHBOX_ID" '.data | any(.id == $id)' >/dev/null

stats=$(request GET "/api/lunchbox/stats/$FAMILY_ID?start_date=2026-03-01&end_date=2026-03-31")
echo "$stats" | jq -e '.data.totalLunchboxes == 1 and (.data.byField.main | length == 1)' >/dev/null

shopping=$(request POST "/api/lunchbox/shopping-list" '{"start_date":"2026-03-09","end_date":"2026-03-15"}')
echo "$shopping" | jq -e '.data.created == 3 and .data.total_lunchboxes == 1' >/dev/null

# Running the week twice must not double anything: the components are already on
# the list, so the second call reports them as skipped.
shopping_again=$(request POST "/api/lunchbox/shopping-list" '{"start_date":"2026-03-09","end_date":"2026-03-15"}')
echo "$shopping_again" | jq -e '.data.created == 0 and .data.skipped == 3' >/dev/null

request PUT "/api/lunchbox/$LUNCHBOX_ID" '{"items":{"main":"Wrap","fruit":"Banane"}}' >/dev/null

# The two AI calls need a configured model; with none they must answer the
# machine-readable code the client translates, not a 500.
ideas_status=$(curl -sS -o /tmp/openfamily-ideas.json -w '%{http_code}' -X POST "$API_BASE/api/lunchbox/ai/ideas" \
  -H "Content-Type: application/json" -H "Authorization: Bearer $TOKEN" \
  -d '{"availableFruits":["Pomme"],"location":"school"}')
if [[ "$ideas_status" != "400" ]] || ! grep -q 'AI_NOT_CONFIGURED' /tmp/openfamily-ideas.json; then
  echo "[FAIL] POST /api/lunchbox/ai/ideas answered $ideas_status for an unconfigured model" >&2
  cat /tmp/openfamily-ideas.json >&2
  exit 1
fi
rm -f /tmp/openfamily-ideas.json

request DELETE "/api/lunchbox/$LUNCHBOX_ID" >/dev/null
# FORK-END: lunchbox

# FORK-START: outings
outings_location=$(curl -sS -o /tmp/openfamily-outings-loc.json -w "%{http_code}" -X POST "$API_BASE/api/outings/suggest" \
  -H "Content-Type: application/json" -H "Authorization: Bearer $TOKEN" -d '{"party":"family","location":"saved"}')
if [[ "$outings_location" != "400" ]] || ! grep -q 'NO_LOCATION' /tmp/openfamily-outings-loc.json; then
  echo "[FAIL] POST /api/outings/suggest answered $outings_location without a saved location" >&2
  cat /tmp/openfamily-outings-loc.json >&2
  exit 1
fi
rm -f /tmp/openfamily-outings-loc.json

request PUT "/api/weather/location" '{"city":"Gent"}' >/dev/null

home_before=$(request GET "/api/weather/location")
assert_success "$home_before"

area=$(request POST "/api/outings/area" '{"city":"Sint-Niklaas"}')
assert_success "$area"
area_city=$(echo "$area" | jq -r '.data.city')
area_lat=$(echo "$area" | jq -r '.data.latitude')
area_lon=$(echo "$area" | jq -r '.data.longitude')

home_after=$(request GET "/api/weather/location")
assert_success "$home_after"
if [[ "$(echo "$home_before" | jq -cS '.data')" != "$(echo "$home_after" | jq -cS '.data')" ]]; then
  echo "[FAIL] Temporary area lookup changed the saved home location" >&2
  exit 1
fi

outings=$(request POST "/api/outings/suggest" \
  "{\"party\":\"kids\",\"duration\":\"short\",\"location\":\"area\",\"city\":\"$area_city\",\"latitude\":$area_lat,\"longitude\":$area_lon,\"date\":\"$(date -u +%Y-%m-%d)\"}")
assert_success "$outings"
echo "$outings" | jq -e '.data.ai == "disabled"' >/dev/null
echo "$outings" | jq -e '.data.placesSource == "osm" and (.data.places | length) > 0' >/dev/null
echo "$outings" | jq -e '.data.places[0].startTime and .data.places[0].endTime' >/dev/null

outings_current=$(request POST "/api/outings/suggest" \
  "{\"party\":\"kids\",\"duration\":\"short\",\"location\":\"current\",\"latitude\":$area_lat,\"longitude\":$area_lon,\"date\":\"$(date -u +%Y-%m-%d)\"}")
assert_success "$outings_current"
echo "$outings_current" | jq -e '.data.placesSource == "osm" and (.data.places | length) > 0' >/dev/null
# FORK-END: outings

echo "[11/12] Dashboard"
request GET "/api/dashboard" >/dev/null

echo "[12/12] Cleanup"
request DELETE "/api/meal-plans/$MEAL_ID" >/dev/null
request DELETE "/api/recipes/$RECIPE_ID" >/dev/null
request DELETE "/api/planning/$PLANNING_ID" >/dev/null
request DELETE "/api/appointments/$APPOINTMENT_ID" >/dev/null
request DELETE "/api/tasks/$TASK_ID" >/dev/null
request DELETE "/api/budget/entries/$BUDGET_ID" >/dev/null
request DELETE "/api/family/$FAMILY_ID" >/dev/null

echo "[OK] OpenFamily API smoke test complete"
