(() => {
  if (window.__k6RecorderInstalled) return;
  window.__k6RecorderInstalled = true;

  const send = (event) =>
    chrome.runtime.sendMessage({ type: "EVENT", event }).catch(() => {});

  function esc(s) {
    if (window.CSS && CSS.escape) return CSS.escape(s);
    return String(s).replace(/([^\w-])/g, "\\$1");
  }

  function unique(sel) {
    try { return document.querySelectorAll(sel).length === 1; }
    catch { return false; }
  }

  function cleanText(s, max = 100) {
    return String(s || "").trim().replace(/\s+/g, " ").slice(0, max);
  }

  function locator(el) {
    if (!el || el.nodeType !== 1) return null;

    if (el.id && unique("#" + esc(el.id))) {
      return { kind: "css", value: "#" + esc(el.id) };
    }

    const stableAttrs = [
      ["data-testid", el.getAttribute("data-testid")],
      ["data-test-id", el.getAttribute("data-test-id")],
      ["data-test", el.getAttribute("data-test")],
      ["data-qa", el.getAttribute("data-qa")],
      ["data-cy", el.getAttribute("data-cy")],
      ["name", el.getAttribute("name")]
    ];

    for (const [attr, value] of stableAttrs) {
      if (!value) continue;
      const q = `[${attr}="${String(value).replace(/"/g, '\\"')}"]`;
      if (unique(q)) return { kind: "css", value: q };
    }

    const aria = el.getAttribute("aria-label");
    if (aria) {
      const q = `[aria-label="${aria.replace(/"/g, '\\"')}"]`;
      if (unique(q)) return { kind: "css", value: q };
    }

    const role = el.getAttribute("role");
    const text = cleanText(el.innerText || el.value, 120);

    if (role && text) {
      const matches = [...document.querySelectorAll(`[role="${esc(role)}"]`)]
        .filter(x => cleanText(x.innerText || x.value, 120) === text);
      if (matches.length === 1) {
        return { kind: "role", role, name: text };
      }
    }

    if (["button", "a"].includes(el.tagName.toLowerCase()) && text) {
      const tag = el.tagName.toLowerCase();
      const matches = [...document.querySelectorAll(tag)]
        .filter(x => cleanText(x.innerText || x.value, 120) === text);
      if (matches.length === 1) {
        return { kind: "text", tag, text };
      }
    }

    let node = el;
    const parts = [];

    for (let i = 0; node && node.nodeType === 1 && i < 7; i++, node = node.parentElement) {
      let p = node.tagName.toLowerCase();

      if (node.id) {
        p += "#" + esc(node.id);
      } else {
        const classes = [...node.classList].filter(Boolean).slice(0, 2);
        if (classes.length) p += "." + classes.map(esc).join(".");

        const parent = node.parentElement;
        if (parent) {
          const siblings = [...parent.children].filter(x => x.tagName === node.tagName);
          if (siblings.length > 1) p += `:nth-of-type(${siblings.indexOf(node) + 1})`;
        }
      }

      parts.unshift(p);
      const candidate = parts.join(" > ");
      if (unique(candidate)) return { kind: "css", value: candidate };
    }

    return { kind: "css", value: el.tagName.toLowerCase() };
  }

  function common(el) {
    const r = el.getBoundingClientRect();
    return {
      selector: locator(el),
      tag: el.tagName.toLowerCase(),
      text: cleanText(el.innerText || el.value),
      x: Math.round(r.x),
      y: Math.round(r.y),
      width: Math.round(r.width),
      height: Math.round(r.height)
    };
  }

  let inputTimer;

  document.addEventListener("input", e => {
    const el = e.target;
    if (!el || !["INPUT", "TEXTAREA"].includes(el.tagName)) return;

    clearTimeout(inputTimer);
    inputTimer = setTimeout(() => {
      const c = common(el);
      send({
        type: "fill",
        selector: c.selector,
        value: el.type === "password" ? "${PASSWORD}" : el.value,
        inputType: el.type || "text"
      });
    }, 250);
  }, true);

  document.addEventListener("change", e => {
    const el = e.target;
    if (!el) return;

    const c = common(el);

    if (el.tagName === "SELECT") {
      const selected = [...el.selectedOptions].map(o => ({
        value: o.value,
        label: cleanText(o.textContent, 100)
      }));

      send({
        type: "select",
        selector: c.selector,
        value: el.value,
        selected
      });
    } else if (el.type === "checkbox" || el.type === "radio") {
      send({
        type: "check",
        selector: c.selector,
        checked: el.checked
      });
    }
  }, true);

  document.addEventListener("click", e => {
    const el = e.target?.closest?.(
      "button,a,input,select,textarea,[role='button'],[role='link'],[role='tab'],[role='checkbox'],[role='radio'],[role='option']"
    );

    if (!el) return;

    const c = common(el);

    send({
      type: "click",
      selector: c.selector,
      text: c.text,
      button: e.button,
      modifiers: [
        e.altKey ? "Alt" : null,
        e.ctrlKey ? "Control" : null,
        e.metaKey ? "Meta" : null,
        e.shiftKey ? "Shift" : null
      ].filter(Boolean)
    });
  }, true);

  document.addEventListener("keydown", e => {
    if (["INPUT", "TEXTAREA"].includes(e.target?.tagName)) {
      if (e.key === "Enter" || e.key === "Tab") {
        const c = common(e.target);
        send({
          type: "press",
          selector: c.selector,
          key: e.key
        });
      }
    }
  }, true);

  // IMPORTANT:
  // We do NOT record raw scrollTop/scrollY as a test action.
  // The generated k6 code will scroll the next target locator into view.
  // This makes the script resilient to different viewport sizes and content heights.
  let lastScroll = 0;
  window.addEventListener("scroll", () => {
    const now = Date.now();
    if (now - lastScroll < 300) return;
    lastScroll = now;
  }, { passive: true });

  // If a target is clicked after the user manually scrolled to it, the click
  // itself is sufficient: locator.click() performs normal actionability checks.
})();
