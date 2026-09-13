const DEFAULT = {
  recording: false,
  events: [],
  currentTransaction: null,
  networkIdle: false,
  pageLoadedCheck: true
};

async function getState() {
  return await chrome.storage.local.get(DEFAULT);
}

async function setState(patch) {
  await chrome.storage.local.set(patch);
}

function addEvent(events, event, transaction) {
  events.push({
    ...event,
    transaction: transaction || null,
    ts: Date.now()
  });
}

chrome.runtime.onInstalled.addListener(async () => {
  await setState(DEFAULT);
  if (chrome.sidePanel) {
    await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
  }
});

chrome.action.onClicked.addListener(async (tab) => {
  if (chrome.sidePanel) await chrome.sidePanel.open({ windowId: tab.windowId });
});

chrome.runtime.onMessage.addListener(async (msg, sender, sendResponse) => {
  const state = await getState();

  if (msg.type === "START") {
    await setState({
      recording: true,
      events: [{
        type: "navigate",
        url: sender.tab?.url || "",
        title: sender.tab?.title || "",
        transaction: null,
        ts: Date.now()
      }],
      currentTransaction: null
    });
    sendResponse({ ok: true });
    return true;
  }

  if (msg.type === "STOP_TXN") {
    if (state.currentTransaction) {
      const events = state.events || [];
      addEvent(events, { type: "transaction_end" }, state.currentTransaction);
      await setState({ events, currentTransaction: null });
    }
    sendResponse({ ok: true });
    return true;
  }

  if (msg.type === "START_TXN") {
    const name = String(msg.name || "").trim();
    if (!name) {
      sendResponse({ ok: false, error: "Transaction name is required" });
      return true;
    }

    const events = state.events || [];

    if (state.currentTransaction) {
      addEvent(events, { type: "transaction_end" }, state.currentTransaction);
    }

    addEvent(events, { type: "transaction_start", name }, name);
    await setState({
      events,
      currentTransaction: name
    });

    sendResponse({ ok: true });
    return true;
  }

  if (msg.type === "STOP") {
    const events = state.events || [];
    if (state.currentTransaction) {
      addEvent(events, { type: "transaction_end" }, state.currentTransaction);
    }
    await setState({
      recording: false,
      events,
      currentTransaction: null
    });
    sendResponse({ ok: true });
    return true;
  }

  if (msg.type === "GET_STATE") {
    sendResponse(state);
    return true;
  }

  if (msg.type === "SET_NETWORK_IDLE") {
    await setState({ networkIdle: !!msg.enabled });
    sendResponse({ ok: true });
    return true;
  }

  if (msg.type === "SET_PAGE_LOADED_CHECK") {
    await setState({ pageLoadedCheck: !!msg.enabled });
    sendResponse({ ok: true });
    return true;
  }

  if (msg.type === "EVENT" && state.recording) {
    const events = state.events || [];
    addEvent(events, msg.event, state.currentTransaction);
    await setState({ events });
    sendResponse({ ok: true });
    return true;
  }

  if (msg.type === "CLEAR") {
    await setState({
      recording: false,
      events: [],
      currentTransaction: null
    });
    sendResponse({ ok: true });
    return true;
  }
});

chrome.webNavigation.onCompleted.addListener(async (details) => {
  if (details.frameId !== 0) return;

  const state = await getState();
  if (!state.recording) return;

  const events = state.events || [];
  addEvent(events, {
    type: "navigate",
    url: details.url
  }, state.currentTransaction);

  await setState({ events });
});
