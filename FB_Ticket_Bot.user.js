// ==UserScript==
// @name         FB 搶票機器人 (V21.0 控制面板版)
// @namespace    http://tampermonkey.net/
// @version      21.0
// @description  基於 V20.1 邏輯，新增 GUI 控制面板與參數動態調整功能
// @author       Gemini
// @match        *://*.facebook.com/*
// @grant        none
// ==/UserScript==

(function() {
    'use strict';

    // ================= 設定區 (預設值) =================
    // 面板未設定時，將使用以下預設值
    const DEFAULT_SIGN_UP_TEXT = "+1男 翰 +1女 Ni";

    // Dynamically calculate next Monday's date for DEFAULT_KEYWORD
    const today = new Date();
    const currentDay = today.getDay(); // 0 = Sunday, 1 = Monday, ... 6 = Saturday
    let daysUntilNextMonday = (1 - currentDay + 7) % 7;
    if (daysUntilNextMonday === 0) { // If today is Monday, we want next Monday.
        daysUntilNextMonday = 7;
    }
    const nextMondayDate = new Date(today.getFullYear(), today.getMonth(), today.getDate() + daysUntilNextMonday);
    const DEFAULT_KEYWORD = `${nextMondayDate.getMonth() + 1}/${nextMondayDate.getDate()}`;

    const DEFAULT_FILTER  = "橋和";
    const DEFAULT_CLICK_X = 507;
    const DEFAULT_CLICK_Y = 125;

    const MONITOR_REFRESH_RATE = 1500;
    const RUSH_POLLING_RATE = 100;
    // =================================================

    const storage = sessionStorage;
    const KEY_MONITOR_ON = "FB_MONITOR_ACTIVE";
    const KEY_RUSH_ON = "FB_RUSH_ACTIVE";
    const KEY_TARGET_NAME = "FB_TARGET_NAME";
    const KEY_TARGET_FILTER = "FB_TARGET_FILTER"; // 新增
    const KEY_SIGN_TEXT = "FB_SIGN_TEXT";         // 新增
    const KEY_CLICK_X = "FB_CLICK_X";             // 新增
    const KEY_CLICK_Y = "FB_CLICK_Y";             // 新增

    let hasClickedCoord = false;

    // ==========================================
    // 新增：GUI 控制面板模組
    // ==========================================
    function createControlPanel() {
        const id = 'fb-control-panel-v21';
        if (document.getElementById(id)) return;

        const panel = document.createElement('div');
        panel.id = id;
        panel.style.cssText = `
            position: fixed; bottom: 20px; right: 20px; width: 300px;
            background: rgba(33, 33, 33, 0.95); color: #fff;
            z-index: 9999999; border-radius: 8px; font-family: 'Segoe UI', sans-serif;
            box-shadow: 0 4px 15px rgba(0,0,0,0.5); border: 1px solid #444;
            font-size: 13px;
        `;

        // 讀取當前數值
        const getVal = (k, def) => storage.getItem(k) || def;
        const isMon = storage.getItem(KEY_MONITOR_ON) === "true";
        const isRush = storage.getItem(KEY_RUSH_ON) === "true";

        panel.innerHTML = `
            <div style="padding: 10px; background: #0D47A1; border-radius: 8px 8px 0 0; font-weight: bold; display: flex; justify-content: space-between;">
                <span>🤖 FB 搶票控制台 V21</span>
                <span id="panel-status" style="color: ${isMon ? '#00E676' : (isRush ? '#FFEA00' : '#B0BEC5')}">●</span>
            </div>
            <div style="padding: 15px;">
                <div style="margin-bottom: 8px; display: flex; align-items: center;">
                    <label style="flex:1;">日期關鍵字:</label>
                    <input type="text" id="inp-keyword" value="${getVal(KEY_TARGET_NAME, DEFAULT_KEYWORD)}" style="width: 160px; padding: 4px; background: #424242; border: 1px solid #616161; color: white; border-radius: 4px;">
                </div>
                <div style="margin-bottom: 8px; display: flex; align-items: center;">
                    <label style="flex:1;">地點濾鏡:</label>
                    <input type="text" id="inp-filter" value="${getVal(KEY_TARGET_FILTER, DEFAULT_FILTER)}" style="width: 160px; padding: 4px; background: #424242; border: 1px solid #616161; color: white; border-radius: 4px;">
                </div>
                <div style="margin-bottom: 8px; display: flex; align-items: center;">
                    <label style="flex:1;">留言內容:</label>
                    <input type="text" id="inp-text" value="${getVal(KEY_SIGN_TEXT, DEFAULT_SIGN_UP_TEXT)}" style="width: 160px; padding: 4px; background: #424242; border: 1px solid #616161; color: white; border-radius: 4px;">
                </div>
                <div style="margin-bottom: 15px; display: flex; gap: 5px;">
                     <input type="number" id="inp-x" value="${getVal(KEY_CLICK_X, DEFAULT_CLICK_X)}" placeholder="X" style="width: 60px; background: #333; color: #aaa; border: none; padding: 3px;">
                     <input type="number" id="inp-y" value="${getVal(KEY_CLICK_Y, DEFAULT_CLICK_Y)}" placeholder="Y" style="width: 60px; background: #333; color: #aaa; border: none; padding: 3px;">
                     <span style="font-size: 10px; color: #aaa; align-self: center;">(座標)</span>
                </div>

                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px;">
                    <button id="btn-monitor" style="padding: 8px; border: none; border-radius: 4px; font-weight: bold; cursor: pointer; background: ${isMon ? '#D32F2F' : '#2E7D32'}; color: white;">
                        ${isMon ? '⏹ 停止監控' : '▶ 啟動監控'}
                    </button>
                    <button id="btn-rush" style="padding: 8px; border: none; border-radius: 4px; font-weight: bold; cursor: pointer; background: ${isRush ? '#D32F2F' : '#F57F17'}; color: white;">
                        ${isRush ? '⏹ 停止搶票' : '⚡ 強制搶票'}
                    </button>
                </div>
                <div style="margin-top:10px; font-size:10px; color:#888; text-align:center;">設定變更即時生效</div>
            </div>
        `;

        document.body.appendChild(panel);

        // 事件綁定
        const inputs = ['inp-keyword', 'inp-filter', 'inp-text', 'inp-x', 'inp-y'];
        const keys = [KEY_TARGET_NAME, KEY_TARGET_FILTER, KEY_SIGN_TEXT, KEY_CLICK_X, KEY_CLICK_Y];

        inputs.forEach((id, idx) => {
            document.getElementById(id).addEventListener('input', (e) => {
                storage.setItem(keys[idx], e.target.value);
            });
        });

        // 監控開關
        document.getElementById('btn-monitor').onclick = function() {
            const current = storage.getItem(KEY_MONITOR_ON) === "true";
            if (current) {
                storage.setItem(KEY_MONITOR_ON, "false");
                this.innerText = "▶ 啟動監控";
                this.style.background = "#2E7D32";
                updateStatusLight();
                window.location.reload(); // 停止後重整以清除狀態
            } else {
                storage.setItem(KEY_MONITOR_ON, "true");
                storage.setItem(KEY_RUSH_ON, "false"); // 互斥
                this.innerText = "⏹ 停止監控";
                this.style.background = "#D32F2F";
                updateStatusLight();
                window.location.reload();
            }
        };

        // 搶票開關
        document.getElementById('btn-rush').onclick = function() {
            const current = storage.getItem(KEY_RUSH_ON) === "true";
            if (current) {
                storage.setItem(KEY_RUSH_ON, "false");
                this.innerText = "⚡ 強制搶票";
                this.style.background = "#F57F17";
                updateStatusLight();
            } else {
                storage.setItem(KEY_RUSH_ON, "true");
                storage.setItem(KEY_MONITOR_ON, "false"); // 互斥
                this.innerText = "⏹ 停止搶票";
                this.style.background = "#D32F2F";
                updateStatusLight();
            }
        };

        function updateStatusLight() {
            const m = storage.getItem(KEY_MONITOR_ON) === "true";
            const r = storage.getItem(KEY_RUSH_ON) === "true";
            const light = document.getElementById('panel-status');
            if(light) light.style.color = m ? '#00E676' : (r ? '#FFEA00' : '#B0BEC5');
        }
    }

    // 初始化面板
    setTimeout(createControlPanel, 1000);

    // ==========================================
    // 原有工具與邏輯 (保留)
    // ==========================================

    function showStatus(msg, color) {
        try {
            let d = document.getElementById('fb-status-v20');
            if (!d) {
                d = document.createElement('div');
                d.id = 'fb-status-v20';
                d.style.cssText = "position:fixed; top:0; left:0; z-index:9999999; padding:6px 12px; color:white; font-size:14px; font-weight:bold; font-family: monospace; background: rgba(0,0,0,0.8); border-bottom-right-radius: 5px;";
                document.body.appendChild(d);
            }
            d.style.background = color;
            d.innerText = msg;
        } catch (e) {}
    }

    function drawScope(x, y) {
        let s = document.getElementById('fb-scope');
        if(!s) {
            s = document.createElement('div');
            s.id = 'fb-scope';
            s.style.cssText = `position:fixed; left:${x-15}px; top:${y-15}px; width:30px; height:30px; border:2px solid #00FF00; border-radius:50%; z-index:9999999; pointer-events:none; box-shadow:0 0 10px #00FF00; background:rgba(0,255,0,0.1);`;
            s.innerHTML = `<div style="position:absolute;top:14px;left:0;width:30px;height:2px;background:#00FF00;"></div><div style="position:absolute;left:14px;top:0;height:30px;width:2px;background:#00FF00;"></div>`;
            document.body.appendChild(s);
        }
    }

    function fuzzyFindAlbum(keyword, filter) {
        const links = document.querySelectorAll('a');
        for (let el of links) {
            const rawText = el.innerText || "";
            const cleanText = rawText.replace(/\s/g, '');
            if (cleanText.includes(keyword) && cleanText.includes(filter)) {
                if (el.offsetParent !== null) return el;
            }
        }
        return null;
    }

    function extractValidUrl(el) {
        if (el.href && el.href.includes('/set/')) return el.href;
        const parent = el.closest('a[href*="/set/"]');
        if (parent && parent.href) return parent.href;
        const child = el.querySelector('a[href*="/set/"]');
        if (child && child.href) return child.href;
        return null;
    }

    function clickAt(x, y) {
        const el = document.elementFromPoint(x, y);
        if (!el) {
            showStatus(`⚠️ 座標 (${x}, ${y}) 未找到任何元素`, "red");
            return false;
        }

        if (el.tagName === 'BODY' || el.tagName === 'HTML' || el.id.startsWith('mount')) {
            showStatus(`⚠️ 準心打空 (背景)`, "red");
            return false;
        }

        showStatus(`🎯 命中: ${el.tagName}，嘗試點擊...`, "#2196F3"); // Blue color for "attempting"

        // Facebook/React may have the click listener on a parent element.
        // Let's walk up the DOM a bit to find a more likely candidate (like a link).
        let clickTarget = el;
        for (let i = 0; i < 4 && clickTarget; i++) {
            if (clickTarget.tagName === 'A' || clickTarget.getAttribute('role')?.includes('link') || clickTarget.getAttribute('role')?.includes('button')) {
                showStatus(`🎯 找到更佳目標: ${clickTarget.tagName}`, "#4CAF50"); // Green for better target
                break; // Found a good candidate
            }
            clickTarget = clickTarget.parentElement;
        }

        if (!clickTarget) {
            clickTarget = el; // Fallback to original element
        }

        const pointerOpts = { bubbles: true, cancelable: true, view: window, clientX: x, clientY: y, pointerType: 'mouse', isPrimary: true };
        const mouseOpts = { bubbles: true, cancelable: true, view: window, clientX: x, clientY: y };

        // A more robust event sequence for modern frameworks like React
        clickTarget.dispatchEvent(new PointerEvent('pointerdown', pointerOpts));
        clickTarget.dispatchEvent(new MouseEvent('mousedown', mouseOpts));
        clickTarget.dispatchEvent(new PointerEvent('pointerup', pointerOpts));
        clickTarget.dispatchEvent(new MouseEvent('mouseup', mouseOpts));
        clickTarget.dispatchEvent(new MouseEvent('click', mouseOpts));
        clickTarget.focus();

        // The native .click() is still a good fallback.
        if (typeof clickTarget.click === 'function') {
            clickTarget.click();
        }

        showStatus(`✅ 已對 ${clickTarget.tagName} 送出點擊`, "#00C853");
        return true;
    }

    function fastInput(target, text) {
        target.focus();
        target.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
        document.execCommand('insertText', false, text);
        target.dispatchEvent(new InputEvent('textInput', { data: text, bubbles: true }));
    }

    function fastEnter(target) {
        const k = {bubbles:true, cancelable:true, keyCode:13, which:13, key:'Enter', code:'Enter'};
        target.dispatchEvent(new KeyboardEvent('keydown', k));
        target.dispatchEvent(new KeyboardEvent('keypress', k));
        target.dispatchEvent(new KeyboardEvent('keyup', k));
    }

    // ==========================================
    // Main Loop
    // ==========================================
    setInterval(() => {
        const url = window.location.href;
        const isMonitorMode = storage.getItem(KEY_MONITOR_ON) === "true";
        const isRushMode = storage.getItem(KEY_RUSH_ON) === "true";

        // ★ 動態讀取參數 (優先讀取面板設定，否則使用預設常數) ★
        const targetName = storage.getItem(KEY_TARGET_NAME) || DEFAULT_KEYWORD;
        const targetFilter = storage.getItem(KEY_TARGET_FILTER) || DEFAULT_FILTER;
        const signUpText = storage.getItem(KEY_SIGN_TEXT) || DEFAULT_SIGN_UP_TEXT;
        const currentClickX = parseInt(storage.getItem(KEY_CLICK_X)) || DEFAULT_CLICK_X;
        const currentClickY = parseInt(storage.getItem(KEY_CLICK_Y)) || DEFAULT_CLICK_Y;

        // 0. 舊版 UI 按鈕 (為了保留相容性，保留代碼但因為有面板，實際上可忽略)
        if (url.includes("/media") && !isMonitorMode && !document.getElementById('init-v20-btn')) {
            // (選擇性保留舊按鈕邏輯，若覺得面板夠用可隱藏)
        }

        // 1. 監控模式
        if (isMonitorMode && url.includes("/media")) {
            // 使用動態 filter
            const targetEl = fuzzyFindAlbum(targetName, targetFilter);

            if (targetEl) {
                targetEl.style.border = "5px solid blue";
                targetEl.style.boxShadow = "0 0 15px blue";

                const validUrl = extractValidUrl(targetEl);

                if (validUrl) {
                    showStatus(`✅ 鎖定目標！強制跳轉中...\n🔗 ${validUrl.substring(0,30)}...`, "blue");
                    storage.setItem(KEY_MONITOR_ON, "false");
                    storage.setItem(KEY_RUSH_ON, "true");
                    window.location.href = validUrl;
                } else {
                    showStatus(`⚠️ 鎖定目標但無連結 (No Href)\n嘗試點擊...`, "orange");
                    targetEl.click();
                }
            } else {
                showStatus(`🔍 監控中... (目標: ${targetName})`, "#555");
                if (!window.hasReloaded) {
                    window.hasReloaded = true;
                    setTimeout(() => window.location.reload(), MONITOR_REFRESH_RATE);
                }
            }
            return;
        }

        // 2. 搶票模式
        if (isRushMode) {
            drawScope(currentClickX, currentClickY); // 使用動態座標

            const isInAlbum = url.includes("/set/") || url.includes("set=");
            const isViewingPhoto = url.includes("photo") || document.querySelector('div[role="dialog"]');

            if (!isInAlbum && !isViewingPhoto) {
                showStatus("⏳ 正在前往相簿...", "orange");
                return;
            }

            // Logic restructure: First, determine if we need to click or comment.
            if (isViewingPhoto) {
                // State: Viewing a single photo. Goal: Find comment box and post.
                const inputs = document.querySelectorAll('div[role="textbox"][data-lexical-editor="true"], div[contenteditable="true"][role="textbox"]');
                if (inputs.length > 0) {
                    const target = inputs[inputs.length - 1];
                    // Check if we already started typing to prevent re-entry
                    if(!target.innerText.includes(signUpText.split(' ')[0])) {
                        showStatus("✍️ 寫入留言...", "blue");
                        fastInput(target, signUpText);
                        setTimeout(() => {
                            if (target.innerText.length > 0) {
                                fastEnter(target);
                                showStatus("✅ 完成！", "#388E3C");
                                storage.removeItem(KEY_RUSH_ON);
                                storage.removeItem(KEY_MONITOR_ON);
                                document.getElementById('fb-scope')?.remove();
                            }
                        }, 100); // Slightly increased delay for safety
                        return; // Exit after starting the comment process
                    }
                } else {
                    // Photo is open, but comment box hasn't loaded yet.
                    showStatus("👀 等待留言框...", "teal");
                }
            } else if (isInAlbum) {
                // State: In album view. Goal: Click the target photo.
                if (hasClickedCoord) return; // Prevent re-clicking while waiting for dialog

                const success = clickAt(currentClickX, currentClickY);
                if (success) {
                    hasClickedCoord = true;
                    // Set a timeout to reset the click flag, allowing re-attempts if the dialog doesn't open
                    setTimeout(() => { hasClickedCoord = false; }, 3000);
                } else {
                    // If clickAt fails, reset sooner to allow another try
                    setTimeout(() => { hasClickedCoord = false; }, 500);
                }
            }
        }

    }, RUSH_POLLING_RATE);
})();
