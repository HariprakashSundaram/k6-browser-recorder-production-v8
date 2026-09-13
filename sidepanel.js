const $ = id => document.getElementById(id);

async function send(type, extra = {}) {
  return await chrome.runtime.sendMessage({ type, ...extra });
}

function jsString(s) {
  return JSON.stringify(String(s ?? ""));
}

function metricName(name, index) {
  let n = String(name || "Transaction")
    .replace(/[^a-zA-Z0-9_]/g, "_")
    .replace(/^[^a-zA-Z_]+/, "");
  if (!n) n = "Transaction";
  return `txn_${n}_${index + 1}`;
}

function assertionName(text, fallback = "Element is visible") {
  const cleaned = String(text || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
  return cleaned ? `${cleaned} is visible` : fallback;
}

function locatorExpr(s) {
  if (!s) return "page.locator('body')";
  if (s.kind === "role" && s.role && s.name) {
    return `page.getByRole(${jsString(s.role)}, { name: ${jsString(s.name)} })`;
  }
  if (s.kind === "text" && s.text) {
    return `page.getByText(${jsString(s.text)}, { exact: true })`;
  }
  return `page.locator(${jsString(s.value || "body")})`;
}

function clickOptions(e) {
  const options = {};
  if (e.button === 1) options.button = "middle";
  else if (e.button === 2) options.button = "right";

  if (Array.isArray(e.modifiers) && e.modifiers.length) {
    options.modifiers = e.modifiers;
  }

  return Object.keys(options).length ? JSON.stringify(options) : "";
}

function emitPrepare(lines, locator) {
  lines.push(`    await ${locator}.waitFor({ state: 'visible' });`);
  lines.push(`    await ${locator}.evaluate((el) => {`);
  lines.push(`      el.scrollIntoView({ block: 'center', inline: 'center' });`);
  lines.push(`    });`);
}

function generate(events, networkIdle, pageLoadedCheck) {
  const blocks = [];
  let active = null;
  let idx = 0;

  for (const e of events) {
    if (e.type === "transaction_start") {
      active = { name: e.name, metric: metricName(e.name, idx++), events: [] };
      blocks.push(active);
    } else if (e.type === "transaction_end") {
      active = null;
    } else if (active) {
      active.events.push(e);
    }
  }

  const lines = [];

  lines.push("import { browser } from 'k6/browser';");
  lines.push("import { check, sleep } from 'k6';");
  lines.push("import { Trend } from 'k6/metrics';");
  lines.push("");
  lines.push("export const options = {");
  lines.push("  scenarios: {");
  lines.push("    single_hit: {");
  lines.push("      executor: 'per-vu-iterations',");
  lines.push("      vus: 1,");
  lines.push("      iterations: 1,");
  lines.push("      maxDuration: '30s',");
  lines.push("      options: {");
  lines.push("        browser: {");
  lines.push("          type: 'chromium',");
  lines.push("        },");
  lines.push("      },");
  lines.push("    },");
  lines.push("  },");
  lines.push("};");
  lines.push("");

  for (const b of blocks) {
    lines.push(`const ${b.metric} = new Trend(${jsString(b.name)}, true);`);
  }

  lines.push("");
  lines.push("export default async function () {");
  lines.push("  const page = await browser.newPage();");
  lines.push("");
  lines.push("  try {");

  function emit(e, eventIndex) {
    if (e.type === "navigate" && e.url) {
      lines.push(`    await page.goto(${jsString(e.url)});`);
      if (networkIdle) {
        lines.push("    await page.waitForLoadState('networkidle');");
      }

      if (pageLoadedCheck) {
        const validationId = `pageLoaded_${eventIndex}`;
        lines.push("    // Optional Page Body / Page Loaded validation (after goto)");
        lines.push("    await page.locator('body').waitFor({ state: 'visible' });");
        lines.push(`    const ${validationId} = await page.locator('body').isVisible();`);
        lines.push(`    check(${validationId}, {`);
        lines.push("      'Page loaded': (loaded) => loaded === true,");
        lines.push("    });");
      }
      return;
    }

    if (e.type === "click" && e.selector) {
      const loc = locatorExpr(e.selector);
      emitPrepare(lines, loc);
      const options = clickOptions(e);
      lines.push(options
        ? `    await ${loc}.click(${options});`
        : `    await ${loc}.click();`);
      return;
    }

    if (e.type === "fill" && e.selector) {
      const loc = locatorExpr(e.selector);
      emitPrepare(lines, loc);
      lines.push(`    await ${loc}.fill(${jsString(e.value)});`);
      return;
    }

    if (e.type === "select" && e.selector) {
      const loc = locatorExpr(e.selector);
      emitPrepare(lines, loc);
      lines.push(`    await ${loc}.selectOption(${jsString(e.value)});`);
      return;
    }

    if (e.type === "check" && e.selector) {
      const loc = locatorExpr(e.selector);
      emitPrepare(lines, loc);
      lines.push(`    await ${loc}.${e.checked ? "check()" : "uncheck()"};`);
      return;
    }

    if (e.type === "press" && e.selector) {
      const loc = locatorExpr(e.selector);
      emitPrepare(lines, loc);
      lines.push(`    await ${loc}.press(${jsString(e.key)});`);
      return;
    }

    // Hover events are intentionally ignored. They are not generated by the recorder.
  }

  blocks.forEach((b, bi) => {
    lines.push(`    // Transaction: ${b.name}`);
    lines.push("    {");
    lines.push(`      const txnStart_${b.metric} = Date.now();`);
    lines.push("");

    b.events.forEach((e, eventIndex) => emit(e, `${bi}_${eventIndex}`));

    lines.push("");
    lines.push(`      ${b.metric}.add(Date.now() - txnStart_${b.metric});`);
    lines.push("    }");

    if (bi < blocks.length - 1) {
      lines.push("");
      lines.push("    // 3-second think time - excluded from transaction Trend timing");
      lines.push("    sleep(3);");
      lines.push("");
    }
  });

  lines.push("  } finally {");
  lines.push("    await page.close();");
  lines.push("  }");
  lines.push("}");
  lines.push("");

  return lines.join("\n");
}

async function refresh() {
  const state = await chrome.runtime.sendMessage({ type: "GET_STATE" });
  $("status").textContent = state.recording ? "Recording..." : "Stopped";
  $("count").textContent = `${(state.events || []).length} events`;
  $("networkIdle").checked = !!state.networkIdle;
  $("pageLoadedCheck").checked = state.pageLoadedCheck !== false;
  $("txnStatus").textContent = state.currentTransaction
    ? `Active: ${state.currentTransaction}`
    : "No active transaction";
  $("output").value = generate(state.events || [], !!state.networkIdle, state.pageLoadedCheck !== false);
}

$("start").onclick = async () => { await send("START"); await refresh(); };
$("stop").onclick = async () => { await send("STOP"); await refresh(); };
$("clear").onclick = async () => { await send("CLEAR"); await refresh(); };

$("networkIdle").onchange = async e => {
  await send("SET_NETWORK_IDLE", { enabled: e.target.checked });
  await refresh();
};

$("pageLoadedCheck").onchange = async e => {
  await send("SET_PAGE_LOADED_CHECK", { enabled: e.target.checked });
  await refresh();
};

$("txnStart").onclick = async () => {
  const name = $("txnName").value.trim();
  if (!name) return alert("Enter a transaction name first.");

  const result = await send("START_TXN", { name });
  if (!result?.ok) return alert(result?.error || "Unable to start transaction.");

  $("txnName").value = "";
  await refresh();
};

$("txnEnd").onclick = async () => {
  await send("STOP_TXN");
  await refresh();
};

$("download").onclick = async () => {
  const state = await chrome.runtime.sendMessage({ type: "GET_STATE" });
  const code = generate(state.events || [], !!state.networkIdle, state.pageLoadedCheck !== false);
  const blob = new Blob([code], { type: "text/javascript" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "k6-browser-recorded.js";
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};

chrome.storage.onChanged.addListener(refresh);
refresh();
