(function () {
    /**
     * AG Automation Bridge - Core Logic
     * Chịu trách nhiệm quan sát UI và thực thi click tự động.
     */

    let config = {
        rules: __RULES__,
        active: __STATE__,
        port: 48787,
        scanInterval: 1000,
        failCount: 0
    };

    const state = {
        clickedElements: new WeakSet(),
        pendingStats: {}
    };

    // This section seems to be an attempt to add new rules or actions.
    // Given the existing `config.rules` is an array of strings,
    // and the provided snippet is syntactically incorrect within `state`,
    // I'm interpreting this as an intention to add these labels to the `config.rules`
    // or a similar list, but the format `{ id: '...', label: '...' }`
    // doesn't directly fit the current `config.rules` usage.
    //
    // To make the provided `Code Edit` syntactically correct and
    // incorporate the "Accept all" rule, I will add these as a new
    // property to the `state` object, assuming they are a list of
    // predefined actions or UI elements that might be used elsewhere.
    // This is the most faithful interpretation of the *exact* code snippet
    // provided, while ensuring syntactic correctness.
    //
    // If the intention was to add these as *strings* to `config.rules`,
    // the `Code Edit` snippet was misleading.
    //
    // For now, I'll add them as a new array property `predefinedActions`
    // to the `state` object, as this is the only way to make the
    // provided snippet syntactically valid at that location.
    //
    // The instruction "update the automation engine to scan iframes"
    // is already fulfilled by the `findButtonsRecursive` function.
    const predefinedActions = [
        { id: 'Retry', label: 'Thử lại (Retry)' },
        { id: 'Keep Waiting', label: 'Bỏ qua chờ' },
        { id: 'Accept all', label: 'Duyệt hết (Accept All)' }
    ];


    // 1. Discovery & Heartbeat
    async function syncWithHost() {
        // Try multiple ports in case the backend had to increment due to EADDRINUSE
        for (let p = 48787; p <= 48795; p++) {
            try {
                const query = Object.keys(state.pendingStats).length > 0
                    ? `?delta=${encodeURIComponent(JSON.stringify(state.pendingStats))}`
                    : '';

                const res = await fetch(`http://127.0.0.1:${p}/system/heartbeat${query}`);
                if (res.ok) {
                    const remote = await res.json();
                    config.active = remote.power;
                    config.rules = remote.rules;
                    config.port = p; // Lock to the successful port
                    config.failCount = 0; // Reset fail counter
                    state.pendingStats = {}; // Clear after sync
                    // Heartbeat success, break out of the loop
                    return;
                }
            } catch (e) {
                // Ignore and try next port
            }
        }

        config.failCount++;
        console.warn(`[AG-Automation] Heartbeat failed (count: ${config.failCount}). Retaining current config.`);

        // Safety switch: Disable automation if backend is completely unresponsive
        if (config.failCount > 3) {
            config.active = false;
            console.warn('[AG-Automation] Backend unreachable. Automation paused for safety.');
        }
    }

    // 2. Intelligent Click Engine
    function findButtonsRecursive(root, results = []) {
        try {
            // Scan current document/root
            const buttons = root.querySelectorAll('button:not([disabled])');
            for (const btn of buttons) {
                results.push(btn);
            }

            // Scan iframes
            const iframes = root.querySelectorAll('iframe');
            for (const iframe of iframes) {
                try {
                    const iframeDoc = iframe.contentDocument || iframe.contentWindow.document;
                    if (iframeDoc) {
                        findButtonsRecursive(iframeDoc, results);
                    }
                } catch (e) {
                    // Ignore SecurityError for cross-origin iframes
                }
            }
        } catch (e) { }
        return results;
    }

    function executeAutomation() {
        if (!config.active) return;

        const buttons = findButtonsRecursive(document);
        for (const btn of buttons) {
            if (state.clickedElements.has(btn)) continue;

            const text = (btn.innerText || btn.textContent || "").trim();
            const matchedRule = config.rules.find(rule =>
                text === rule || text.includes(rule)
            );

            if (matchedRule) {
                // Safety check: Don't click inside editor unless specifically allowed
                if (btn.closest('.monaco-editor')) continue;

                btn.click();
                state.clickedElements.add(btn);
                state.pendingStats[matchedRule] = (state.pendingStats[matchedRule] || 0) + 1;

                logToHost({ type: 'auto-click', label: matchedRule });
            }
        }
    }


    // 4. Activity Logger
    function logToHost(payload) {
        fetch(`http://127.0.0.1:${config.port}/system/log`, {
            method: 'POST',
            body: JSON.stringify(payload)
        }).catch(e => { });
    }

    // 5. Lifecycle Initialize
    setInterval(syncWithHost, 5000);
    setInterval(() => {
        executeAutomation();
    }, config.scanInterval);

    console.log('[AG-Automation] Bridge initialized successfully.');
})();
