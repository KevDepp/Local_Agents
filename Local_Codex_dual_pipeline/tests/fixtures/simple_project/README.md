# UI Test Prompt

This project provides a minimal UI for turning a natural-language prompt into a repeatable test scenario, plus Playwright-based UI tests.

Assumptions used for this iteration
- The UI is a single-page prompt runner focused on generating a stable scenario checklist.
- A lightweight end-to-end test stack is acceptable. Playwright was selected for readable UI tests and strong selector semantics.

Run the UI locally
- Open `public/index.html` directly in a browser.

Run the UI tests
1. `npm install`
2. `npx playwright install`
3. `npm test`

Add a new UI scenario
1. Update `public/app.js` to add the scenario logic or additional steps.
2. Add a matching Playwright test in `tests/ui.spec.js`.
3. Run `npm test`.

Known limitations
- The UI uses a static set of base steps rather than dynamic scenario parsing.
- The tests are file-based (no web server) and focus on core interactions only.
