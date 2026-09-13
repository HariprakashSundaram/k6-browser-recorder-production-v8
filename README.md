# k6 Browser UI Recorder - Production Update

Chrome MV3 extension that records manual browser UI actions and generates a k6/browser script.

## Included behavior

- Chrome side panel recorder
- Transaction names and separate Trend metrics
- Single VU / single iteration using `per-vu-iterations`
- Chromium browser scenario
- 30 second max duration
- 3 second think time between transactions, excluded from Trend timing
- Optional `networkidle` wait
- Resilient locator generation using stable IDs, test attributes, names, aria labels, roles/text and CSS fallback
- Element-based scrolling using `locator.evaluate(...el.scrollIntoView(...))`
- No hard-coded `scrollTo(x, y)` coordinates
- Visibility checks before recorded interactions
- `check()` validation for page and element visibility
- `try/finally` page cleanup
- Password values recorded as `${PASSWORD}`
- Click, fill, select, checkbox/radio, Enter/Tab and hover events

## Important k6 compatibility fix

This version does NOT generate `locator.scrollIntoViewIfNeeded()`.

It generates:

```js
await element.waitFor({ state: 'visible' });
await element.evaluate((el) => {
  el.scrollIntoView({ block: 'center', inline: 'center' });
});
await element.click();
```

`Locator.evaluate()` is part of the current k6 browser Locator API and lets the recorder scroll the actual target element rather than relying on a hard-coded scroll position.

## Validation

Generated scripts import the built-in k6 `check()` function and validate that the page body or recorded target element is visible. A failed `check()` is reported as a failed check; it does not automatically abort the iteration.

## Install

1. Extract the ZIP.
2. Open Chrome extensions.
3. Enable Developer mode.
4. Choose Load unpacked.
5. Select the extracted extension directory.
6. Open the k6 Recorder from the Chrome toolbar.

## Generated script

The generated script uses:

```js
executor: 'per-vu-iterations'
vus: 1
iterations: 1
maxDuration: '30s'
```

and:

```js
options: {
  browser: {
    type: 'chromium',
  },
}
```


## v7 fixes
- Page Body / Page Loaded validation is optional and enabled by default.
- Every generated page-loaded validation variable is unique (`pageLoaded_0_0`, etc.), preventing duplicate `const` declarations.
- Element preparation no longer creates temporary visibility variables, preventing duplicate declarations.
- Element scrolling uses `locator.evaluate()` + DOM `scrollIntoView()`; `scrollIntoViewIfNeeded()` is never generated.


## v8 changes
- Hover events are not recorded and never generated.
- Page Body / Page Loaded validation remains optional.
- When enabled, validation is generated only after the recorded `page.goto(...)`, never before the launch URL.
- Page validation identifiers are unique across the entire generated script.
