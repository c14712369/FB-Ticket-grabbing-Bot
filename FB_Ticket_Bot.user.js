// ==UserScript==
// @name         FB 搶票機器人 (V21.1 視覺辨識版)
// @namespace    http://tampermonkey.net/
// @version      21.1
// @description  基於 V21.0，新增 Tesseract.js 視覺影像辨識功能，可自動尋找圖片上的特定文字並點擊
// @author       Gemini
// @match        *://*.facebook.com/*
// @grant        GM_xmlhttpRequest
// @connect      *
// @require      https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js
// ==/UserScript==

(function() {
    'use strict';

    // ================= 設定區 (預設值) =================
    const DEFAULT_SIGN_UP_TEXT = "+1男 翰 +1女 Ni";

    const today = new Date();
    const currentDay = today.getDay(); 
    let daysUntilNextMonday = (1 - currentDay + 7) % 7;
    if (daysUntilNextMonday === 0) { 
        daysUntilNextMonday = 7;
    }
    const nextMondayDate = new Date(today.getFullYear(), today.getMonth(), today.getDate() + daysUntilNextMonday);
    const DEFAULT_KEYWORD = `${nextMondayDate.getMonth() + 1}/${nextMondayDate.getDate()}`;

    const DEFAULT_FILTER  = "橋和";
    const DEFAULT_CLICK_X = 507;
    const DEFAULT_CLICK_Y = 125;
    const DEFAULT_OCR_DATE = "3/14";
    const DEFAULT_OCR_TIME = "19:00";

    const MONITOR_REFRESH_RATE = 1500;
    const RUSH_POLLING_RATE = 100;
    // =================================================

    const storage = sessionStorage;
    const KEY_MONITOR_ON = "FB_MONITOR_ACTIVE";
    const KEY_RUSH_ON = "FB_RUSH_ACTIVE";
    const KEY_TARGET_NAME = "FB_TARGET_NAME";
    const KEY_TARGET_FILTER = "FB_TARGET_FILTER"; 
    const KEY_SIGN_TEXT = "FB_SIGN_TEXT";         
    const KEY_CLICK_X = "FB_CLICK_X";             
    const KEY_CLICK_Y = "FB_CLICK_Y";             
    const KEY_COORD_RECORDS = "FB_COORD_RECORDS"; 
    const KEY_TARGET_TIME = "FB_TARGET_TIME";     
    const KEY_REFRESH_RATE = "FB_REFRESH_RATE";   
    const KEY_PANEL_LEFT = "FB_PANEL_LEFT";       
    const KEY_PANEL_TOP = "FB_PANEL_TOP";         

    // 新增辨識模式參數
    const KEY_TARGET_MODE = "FB_TARGET_MODE";     // 'coord' 或是 'ocr'
    const KEY_OCR_DATE = "FB_OCR_DATE";           // OCR 辨識的日期關鍵字
    const KEY_OCR_TIME = "FB_OCR_TIME";           // OCR 辨識的時段關鍵字

    let hasClickedCoord = false;

    // Helper: Fetch Image Bypassing CORS
    function fetchImageBlob(url) {
        return new Promise((resolve, reject) => {
            GM_xmlhttpRequest({
                method: 'GET',
                url: url,
                responseType: 'blob',
                onload: function(response) {
                    if (response.status === 200) {
                        resolve(response.response);
                    } else {
                        reject(new Error(`Failed to fetch image: ${response.statusText}`));
                    }
                },
                onerror: function(error) {
                    reject(error);
                }
            });
        });
    }

    // ==========================================
    // GUI 控制面板模組
    // ==========================================
    function createControlPanel() {
        const id = 'fb-control-panel-v21';
        if (document.getElementById(id)) return;

        const getVal = (k, def) => storage.getItem(k) || def;
        const isMon = storage.getItem(KEY_MONITOR_ON) === "true";
        const isRush = storage.getItem(KEY_RUSH_ON) === "true";
        const records = JSON.parse(getVal(KEY_COORD_RECORDS, "[]"));

        const panel = document.createElement('div');
        panel.id = id;
        
        const savedLeft = storage.getItem(KEY_PANEL_LEFT);
        const savedTop = storage.getItem(KEY_PANEL_TOP);
        let posStyle = savedLeft && savedTop 
            ? `left: ${savedLeft}px; top: ${savedTop}px;` 
            : `right: 20px; bottom: 20px;`;

        panel.style.cssText = `
            position: fixed; ${posStyle} width: 320px;
            background: rgba(33, 33, 33, 0.95); color: #fff;
            z-index: 9999999; border-radius: 8px; font-family: 'Segoe UI', sans-serif;
            box-shadow: 0 4px 15px rgba(0,0,0,0.5); border: 1px solid #444;
            font-size: 13px;
        `;

        panel.innerHTML = `
            <div id="fb-panel-header" style="padding: 10px; background: #0D47A1; border-radius: 8px 8px 0 0; font-weight: bold; display: flex; justify-content: space-between; cursor: move; user-select: none;">
                <span>🤖 FB 搶票控制台 V21.1 視覺版</span>
                <div>
                    <span id="panel-status" style="color: ${isMon ? '#00E676' : (isRush ? '#FFEA00' : '#B0BEC5')}; margin-right: 5px;">●</span>
                    <button id="btn-close-panel" style="background:none; border:none; color:white; font-weight:bold; cursor:pointer; font-size:14px; padding:0 5px;" title="關閉控制面板">✖</button>
                </div>
            </div>
            <div style="padding: 15px;">
                <div style="margin-bottom: 8px; display: flex; align-items: center;">
                    <label style="flex:1;">目標尋找模式:</label>
                    <select id="sel-mode" style="width: 160px; padding: 4px; background: #424242; color: white; border: 1px solid #616161; border-radius: 4px;">
                        <option value="coord" ${getVal(KEY_TARGET_MODE, 'coord') === 'coord' ? 'selected' : ''}>🎯 固定座標點擊</option>
                        <option value="ocr" ${getVal(KEY_TARGET_MODE, 'coord') === 'ocr' ? 'selected' : ''}>🔍 影像文字辨識</option>
                    </select>
                </div>
                <div id="ocr-settings" style="display: ${getVal(KEY_TARGET_MODE, 'coord') === 'ocr' ? 'block' : 'none'}; padding: 10px; background: rgba(0,188,212,0.1); border-radius: 4px; border: 1px dashed #00BCD4; margin-bottom: 8px;">
                    <div style="display: flex; align-items: center; margin-bottom: 5px;">
                        <label style="flex:1; color:#00BCD4;">辨識日期關鍵字:</label>
                        <input type="text" id="inp-ocr-date" value="${getVal(KEY_OCR_DATE, DEFAULT_OCR_DATE)}" style="width: 140px; padding: 4px; background: #333; border: 1px solid #00BCD4; color: white; border-radius: 4px;">
                    </div>
                    <div style="display: flex; align-items: center;">
                        <label style="flex:1; color:#00BCD4;">辨識時段關鍵字:</label>
                        <input type="text" id="inp-ocr-time" value="${getVal(KEY_OCR_TIME, DEFAULT_OCR_TIME)}" placeholder="如: 19:00" style="width: 140px; padding: 4px; background: #333; border: 1px solid #00BCD4; color: white; border-radius: 4px;">
                    </div>
                </div>

                <div style="margin-bottom: 8px; display: flex; align-items: center;">
                    <label style="flex:1;">啟動時間:</label>
                    <input type="time" id="inp-time" value="${getVal(KEY_TARGET_TIME, "")}" style="width: 160px; padding: 4px; background: #424242; border: 1px solid #616161; color: white; border-radius: 4px;">
                </div>
                <div style="margin-bottom: 8px; display: flex; align-items: center;">
                    <label style="flex:1;">相簿尋找關鍵字:</label>
                    <input type="text" id="inp-keyword" value="${getVal(KEY_TARGET_NAME, DEFAULT_KEYWORD)}" style="width: 160px; padding: 4px; background: #424242; border: 1px solid #616161; color: white; border-radius: 4px;">
                </div>
                <div style="margin-bottom: 8px; display: flex; align-items: center;">
                    <label style="flex:1;">相簿地點濾鏡:</label>
                    <input type="text" id="inp-filter" value="${getVal(KEY_TARGET_FILTER, DEFAULT_FILTER)}" style="width: 160px; padding: 4px; background: #424242; border: 1px solid #616161; color: white; border-radius: 4px;">
                </div>
                <div style="margin-bottom: 8px; display: flex; align-items: center;">
                    <label style="flex:1;">留言內容:</label>
                    <input type="text" id="inp-text" value="${getVal(KEY_SIGN_TEXT, DEFAULT_SIGN_UP_TEXT)}" style="width: 160px; padding: 4px; background: #424242; border: 1px solid #616161; color: white; border-radius: 4px;">
                </div>

                <div id="coord-settings" style="display: ${getVal(KEY_TARGET_MODE, 'coord') === 'coord' ? 'block' : 'none'}; margin: 10px 0; padding: 10px; background: rgba(255,255,255,0.05); border-radius: 4px; border: 1px dashed #555;">
                    <div style="margin-bottom: 8px; display: flex; gap: 5px;">
                         <input type="number" id="inp-x" value="${getVal(KEY_CLICK_X, DEFAULT_CLICK_X)}" placeholder="X" style="width: 65px; background: #333; color: #fff; border: 1px solid #555; padding: 3px;">
                         <input type="number" id="inp-y" value="${getVal(KEY_CLICK_Y, DEFAULT_CLICK_Y)}" placeholder="Y" style="width: 65px; background: #333; color: #fff; border: 1px solid #555; padding: 3px;">
                         <button id="btn-capture" style="flex:1; padding: 3px; background: #00838F; color: white; border: none; border-radius: 3px; cursor: pointer; font-size: 11px;">📍 擷取</button>
                    </div>
                    <div style="margin-bottom: 8px; display: flex; gap: 5px;">
                         <input type="text" id="inp-record-name" placeholder="紀錄名稱" style="flex:1; padding: 4px; background: #424242; border: 1px solid #616161; color: white; border-radius: 4px; font-size: 11px;">
                         <button id="btn-save-record" style="padding: 4px 10px; background: #2E7D32; color: white; border: none; border-radius: 4px; cursor: pointer; font-size: 11px;">💾 儲存</button>
                    </div>
                    <select id="sel-records" style="width: 100%; padding: 4px; background: #424242; color: white; border: 1px solid #616161; border-radius: 4px; font-size: 11px;">
                        <option value="">-- 選取已存座標 --</option>
                        ${records.map((r, i) => `<option value="${i}">${r.name} (${r.x}, ${r.y})</option>`).join('')}
                    </select>
                </div>

                <div style="display: grid; grid-template-columns: 1fr; gap: 10px; margin-bottom: 10px; margin-top: 15px;">
                    <button id="btn-monitor" style="padding: 8px; border: none; border-radius: 4px; font-weight: bold; cursor: pointer; background: ${isMon ? '#D32F2F' : '#2E7D32'}; color: white;">
                        ${isMon ? '⏹ 停止監控' : '▶ 啟動監控'}
                    </button>
                </div>
                <div style="margin-top:10px; font-size:10px; color:#888; text-align:center;">設定變更即時生效</div>
            </div>
        `;

        document.body.appendChild(panel);

        // --- 拖曳與關閉功能 ---
        const header = document.getElementById('fb-panel-header');
        let isDragging = false;
        let startX, startY, initialLeft, initialTop;

        header.addEventListener('mousedown', (e) => {
            if (e.target.id === 'btn-close-panel') return;
            isDragging = true;
            startX = e.clientX;
            startY = e.clientY;
            const rect = panel.getBoundingClientRect();
            initialLeft = rect.left;
            initialTop = rect.top;
            panel.style.bottom = 'auto';
            panel.style.right = 'auto';
            panel.style.left = initialLeft + 'px';
            panel.style.top = initialTop + 'px';
        });

        document.addEventListener('mousemove', (e) => {
            if (!isDragging) return;
            const newLeft = initialLeft + (e.clientX - startX);
            const newTop = initialTop + (e.clientY - startY);
            panel.style.left = newLeft + 'px';
            panel.style.top = newTop + 'px';
            storage.setItem(KEY_PANEL_LEFT, newLeft);
            storage.setItem(KEY_PANEL_TOP, newTop);
        });

        document.addEventListener('mouseup', () => { isDragging = false; });
        document.getElementById('btn-close-panel').addEventListener('click', () => {
            storage.setItem(KEY_MONITOR_ON, "false");
            storage.setItem(KEY_RUSH_ON, "false");
            document.getElementById('fb-scope')?.remove();
            panel.remove();
            showStatus("🛑 搶票腳本已手動關閉。", "#D32F2F");
        });

        // 模式切換邏輯
        document.getElementById('sel-mode').addEventListener('change', (e) => {
            const mode = e.target.value;
            storage.setItem(KEY_TARGET_MODE, mode);
            document.getElementById('ocr-settings').style.display = mode === 'ocr' ? 'block' : 'none';
            document.getElementById('coord-settings').style.display = mode === 'coord' ? 'block' : 'none';
            if (mode === 'ocr') {
                document.getElementById('fb-scope')?.remove();
            } else {
                drawScope(parseInt(document.getElementById('inp-x').value), parseInt(document.getElementById('inp-y').value));
            }
        });

        // 事件綁定
        const inputs = ['inp-time', 'inp-keyword', 'inp-filter', 'inp-text', 'inp-x', 'inp-y', 'inp-ocr-date'];
        const keys = [KEY_TARGET_TIME, KEY_TARGET_NAME, KEY_TARGET_FILTER, KEY_SIGN_TEXT, KEY_CLICK_X, KEY_CLICK_Y, KEY_OCR_DATE];

        inputs.forEach((id, idx) => {
            document.getElementById(id).addEventListener('input', (e) => {
                storage.setItem(keys[idx], e.target.value);
                if ((id === 'inp-x' || id === 'inp-y') && storage.getItem(KEY_TARGET_MODE) === 'coord') {
                    document.getElementById('fb-scope')?.remove();
                    drawScope(parseInt(document.getElementById('inp-x').value), parseInt(document.getElementById('inp-y').value));
                }
            });
        });

        // 座標相關功能...
        document.getElementById('btn-save-record').onclick = function() {
            const name = document.getElementById('inp-record-name').value.trim() || `座標_${new Date().toLocaleTimeString()}`;
            const x = parseInt(document.getElementById('inp-x').value);
            const y = parseInt(document.getElementById('inp-y').value);
            const list = JSON.parse(storage.getItem(KEY_COORD_RECORDS) || "[]");
            list.push({ name, x, y });
            storage.setItem(KEY_COORD_RECORDS, JSON.stringify(list));
            updateRecordSelect();
            document.getElementById('inp-record-name').value = "";
            showStatus(`💾 已儲存: ${name}`, "#2E7D32");
        };

        function updateRecordSelect() {
            const list = JSON.parse(storage.getItem(KEY_COORD_RECORDS) || "[]");
            const select = document.getElementById('sel-records');
            select.innerHTML = '<option value="">-- 選取已存座標 --</option>' + 
                list.map((r, i) => `<option value="${i}">${r.name} (${r.x}, ${r.y})</option>`).join('');
        }

        document.getElementById('sel-records').onchange = function() {
            const idx = this.value;
            if (idx === "") return;
            const list = JSON.parse(storage.getItem(KEY_COORD_RECORDS) || "[]");
            const record = list[idx];
            storage.setItem(KEY_CLICK_X, record.x);
            storage.setItem(KEY_CLICK_Y, record.y);
            document.getElementById('inp-x').value = record.x;
            document.getElementById('inp-y').value = record.y;
            document.getElementById('fb-scope')?.remove();
            drawScope(record.x, record.y);
            showStatus(`📍 已套用: ${record.name}`, "#0D47A1");
        };

        let isCapturing = false;
        let captureClickHandler = null, captureKeyHandler = null;

        document.getElementById('btn-capture').onclick = function() {
            const btn = this;
            const originalText = "📍 擷取";
            if (isCapturing) { cancelCapture(); return; }
            isCapturing = true;
            btn.innerText = "✖ 取消";
            btn.style.background = "#D32F2F";
            document.body.style.cursor = "crosshair";
            showStatus("📍 擷取模式已啟動，請點擊目標位置 (按 ESC 取消)", "#00ACC1");

            function cancelCapture() {
                isCapturing = false;
                btn.innerText = originalText;
                btn.style.background = "#00838F";
                document.body.style.cursor = "default";
                document.removeEventListener('click', captureClickHandler, true);
                document.removeEventListener('keydown', captureKeyHandler, true);
                showStatus("🛑 已取消座標擷取", "#757575");
            }

            captureKeyHandler = (e) => { if (e.key === 'Escape') cancelCapture(); };
            captureClickHandler = (e) => {
                if (panel.contains(e.target)) return;
                e.preventDefault(); e.stopPropagation();
                const x = e.clientX, y = e.clientY;
                storage.setItem(KEY_CLICK_X, x);
                storage.setItem(KEY_CLICK_Y, y);
                document.getElementById('inp-x').value = x;
                document.getElementById('inp-y').value = y;
                cancelCapture();
                document.getElementById('fb-scope')?.remove();
                drawScope(x, y);
                showStatus(`✅ 已記錄座標: (${x}, ${y})`, "#43A047");
            };
            document.addEventListener('click', captureClickHandler, true);
            document.addEventListener('keydown', captureKeyHandler, true);
        };

        document.getElementById('btn-monitor').onclick = function() {
            const current = storage.getItem(KEY_MONITOR_ON) === "true";
            if (current) {
                storage.setItem(KEY_MONITOR_ON, "false");
                this.innerText = "▶ 啟動監控";
                this.style.background = "#2E7D32";
                updateStatusLight();
                window.location.reload(); 
            } else {
                storage.setItem(KEY_MONITOR_ON, "true");
                storage.setItem(KEY_RUSH_ON, "false"); 
                this.innerText = "⏹ 停止監控";
                this.style.background = "#D32F2F";
                updateStatusLight();
                window.location.reload();
            }
        };

        function updateStatusLight() {
            const m = storage.getItem(KEY_MONITOR_ON) === "true";
            const r = storage.getItem(KEY_RUSH_ON) === "true";
            const light = document.getElementById('panel-status');
            if(light) light.style.color = m ? '#00E676' : (r ? '#FFEA00' : '#B0BEC5');
        }
    }

    setTimeout(createControlPanel, 1000);

    // ==========================================
    // 核心邏輯區
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
            s.style.cssText = `position:fixed; left:${x-15}px; top:${y-15}px; width:30px; height:30px; border:2px solid #00FF00; border-radius:50%; z-index:9999999; pointer-events:none; box-shadow:0 0 10px #00FF00; background:rgba(0,255,0,0.1); transition: opacity 0.5s;`;
            s.innerHTML = `<div style="position:absolute;top:14px;left:0;width:30px;height:2px;background:#00FF00;"></div><div style="position:absolute;left:14px;top:0;height:30px;width:2px;background:#00FF00;"></div>`;
            document.body.appendChild(s);
        } else {
            s.style.left = `${x-15}px`;
            s.style.top = `${y-15}px`;
            s.style.opacity = '1';
        }

        if (window.scopeTimeout) clearTimeout(window.scopeTimeout);
        window.scopeTimeout = setTimeout(() => {
            if (s) {
                s.style.opacity = '0';
                setTimeout(() => s.remove(), 500);
            }
        }, 2000);
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

        showStatus(`🎯 命中: ${el.tagName}，嘗試點擊...`, "#2196F3");
        let clickTarget = el;
        for (let i = 0; i < 4 && clickTarget; i++) {
            if (clickTarget.tagName === 'A' || clickTarget.getAttribute('role')?.includes('link') || clickTarget.getAttribute('role')?.includes('button')) {
                showStatus(`🎯 找到更佳目標: ${clickTarget.tagName}`, "#4CAF50");
                break;
            }
            clickTarget = clickTarget.parentElement;
        }
        if (!clickTarget) clickTarget = el;

        const pointerOpts = { bubbles: true, cancelable: true, clientX: x, clientY: y, pointerType: 'mouse', isPrimary: true };
        const mouseOpts = { bubbles: true, cancelable: true, clientX: x, clientY: y };

        clickTarget.dispatchEvent(new PointerEvent('pointerdown', pointerOpts));
        clickTarget.dispatchEvent(new MouseEvent('mousedown', mouseOpts));
        clickTarget.dispatchEvent(new PointerEvent('pointerup', pointerOpts));
        clickTarget.dispatchEvent(new MouseEvent('mouseup', mouseOpts));
        clickTarget.dispatchEvent(new MouseEvent('click', mouseOpts));
        clickTarget.focus();

        if (typeof clickTarget.click === 'function') {
            clickTarget.click();
        }

        showStatus(`✅ 已對 ${clickTarget.tagName} 送出點擊`, "#00C853");
        return true;
    }

    function clickElementCenter(el) {
        const rect = el.getBoundingClientRect();
        const x = rect.left + rect.width / 2;
        const y = rect.top + rect.height / 2;
        return clickAt(x, y);
    }

    function fastInput(target, text) {
        target.focus();
        target.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
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

        const targetName = storage.getItem(KEY_TARGET_NAME) || DEFAULT_KEYWORD;
        const targetFilter = storage.getItem(KEY_TARGET_FILTER) || DEFAULT_FILTER;
        const signUpText = storage.getItem(KEY_SIGN_TEXT) || DEFAULT_SIGN_UP_TEXT;
        const targetMode = storage.getItem(KEY_TARGET_MODE) || 'coord';
        const currentClickX = parseInt(storage.getItem(KEY_CLICK_X)) || DEFAULT_CLICK_X;
        const currentClickY = parseInt(storage.getItem(KEY_CLICK_Y)) || DEFAULT_CLICK_Y;
        const ocrDateKeyword = storage.getItem(KEY_OCR_DATE) || DEFAULT_OCR_DATE;
        const ocrTimeKeyword = storage.getItem(KEY_OCR_TIME) || DEFAULT_OCR_TIME;

        // 1. 監控模式
        if (isMonitorMode && url.includes("/media")) {
            const targetTimeStr = storage.getItem(KEY_TARGET_TIME);
            if (targetTimeStr) {
                const now = new Date();
                const [targetHour, targetMinute] = targetTimeStr.split(':').map(Number);
                const targetDate = new Date(now.getFullYear(), now.getMonth(), now.getDate(), targetHour, targetMinute, 0, 0);
                
                if (now < targetDate) {
                    showStatus(`⏳ 監控等待中... 將於 ${targetTimeStr} 啟動`, "#FF9800");
                    return; 
                }
            }

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
                    showStatus(`⚠️ 鎖定目標但無連結\n嘗試點擊...`, "orange");
                    storage.setItem(KEY_MONITOR_ON, "false");
                    storage.setItem(KEY_RUSH_ON, "true");
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
            // 判斷是否已經成功點開了照片的大圖視窗
            // FB 的大圖模式通常會開啟一個 dialog，裡面包含照片
            const photoDialog = document.querySelector('div[role="dialog"]');
            const isViewingPhoto = (photoDialog && photoDialog.offsetParent !== null) && (url.includes("photo") || url.includes("fbid="));
            
            // 判斷是否在相簿列表 (網址有 set，且還沒有打開大圖)
            const isInAlbum = (url.includes("/set/") || url.includes("set=")) && !isViewingPhoto;

            if (!isInAlbum && !isViewingPhoto) {
                showStatus("⏳ 正在前往相簿...", "orange");
                return;
            }

            // A) 如果已經打開圖片 (進入相片大圖模式)，則準備留言
            if (isViewingPhoto) {
                // 在 dialog 內尋找留言框，確保不會填到相簿列表的留言框
                const inputs = photoDialog.querySelectorAll('div[role="textbox"][data-lexical-editor="true"], div[contenteditable="true"][role="textbox"]');
                if (inputs.length > 0) {
                    const target = inputs[inputs.length - 1];
                    // 確認留言框是顯示的 (沒有被隱藏)
                    if (target.offsetParent !== null && !target.innerText.includes(signUpText.split(' ')[0])) {
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
                        }, 100);
                        return;
                    }
                } else {
                    showStatus("👀 等待留言框載入...", "teal");
                }
            } 
            // B) 尚未打開圖片，在相簿列表中尋找目標圖片
            else if (isInAlbum) {
                if (hasClickedCoord) return; 

                // --- 模式 1: 固定座標 ---
                if (targetMode === 'coord') {
                    drawScope(currentClickX, currentClickY);
                    const success = clickAt(currentClickX, currentClickY);
                    if (success) {
                        hasClickedCoord = true;
                        setTimeout(() => { hasClickedCoord = false; }, 3000);
                    } else {
                        setTimeout(() => { hasClickedCoord = false; }, 500);
                    }
                } 
                // --- 模式 2: OCR 視覺辨識 ---
                else if (targetMode === 'ocr') {
                    if (window._isOcrRunning) return; 
                    
                    // 獲取所有相片 img (排除太小的圖示與 emoji)
                    let images = Array.from(document.querySelectorAll('img')).filter(img => {
                        const rect = img.getBoundingClientRect();
                        return rect.width > 50 && rect.height > 50 && img.src && !img.src.includes('emoji');
                    });

                    // 為了加速辨識並節省 API 額度，我們只掃描畫面上出現的前 5 張圖片
                    images = images.slice(0, 5);

                    if (images.length === 0) return;

                    window._isOcrRunning = true;
                    
                    // 【捷徑】1. 優先檢查 FB 自動產生的 alt text 或 aria-label，這最快
                    let targetElement = null;
                    for (const img of images) {
                        const alt = img.getAttribute('alt') || "";
                        const ariaLabel = img.getAttribute('aria-label') || "";
                        const textToSearch = (alt + " " + ariaLabel).replace(/\s/g, '');
                        
                        const dateClean = ocrDateKeyword.replace(/\s/g, '');
                        const timeClean = ocrTimeKeyword.replace(/\s/g, '');

                        const matchDate = dateClean === "" || textToSearch.includes(dateClean);
                        const matchTime = timeClean === "" || textToSearch.includes(timeClean);

                        if (matchDate && matchTime && (dateClean !== "" || timeClean !== "")) {
                            targetElement = img;
                            break;
                        }
                    }

                    if (targetElement) {
                        showStatus(`⚡ 快速辨識：標籤找到 ${ocrDateKeyword} 圖片！點擊中...`, "green");
                        // 針對捷徑，直接使用原生點擊，跳過座標計算的延遲
                        targetElement.click(); 
                        let parentA = targetElement.closest('a');
                        if(parentA) parentA.click();
                        
                        if (clickElementCenter(targetElement)) {
                            hasClickedCoord = true;
                            setTimeout(() => { hasClickedCoord = false; }, 3000);
                        }
                        window._isOcrRunning = false;
                        return;
                    }

                    // 【常規】2. 呼叫外部 API 進行實時影像辨識 (繞過 FB CSP 封鎖)
                    showStatus(`🔍 啟動 OCR 掃描影像文字... 尋找 ${ocrDateKeyword}`, "orange");
                    
                    window._processedOcrImages = window._processedOcrImages || new Set();

                    (async () => {
                        try {
                            let found = false;
                            for (let i = 0; i < images.length; i++) {
                                const img = images[i];
                                if (window._processedOcrImages.has(img.src)) continue; 
                                
                                showStatus(`🔍 OCR 辨識影像中... (掃描進度 ${i + 1}/${images.length})`, "orange");
                                try {
                                    console.log(`[OCR 測試] 準備抓取圖片: ${img.src.substring(0, 50)}...`);
                                    
                                    // 將圖片轉換成 Base64，因為直接丟 img.src (若是 fb 內部或者 blob 網址) 外部 API 可能抓不到
                                    const blob = await fetchImageBlob(img.src);
                                    if (!blob) throw new Error("Fetch blob failed, result is null");

                                    const reader = new FileReader();
                                    const base64data = await new Promise((res, rej) => {
                                        reader.onloadend = () => res(reader.result);
                                        reader.onerror = () => rej(reader.error);
                                        reader.readAsDataURL(blob);
                                    });

                                    // 使用 Base64 透過 POST 傳送給 OCR API
                                    const formData = new FormData();
                                    // 更換為穩定的免費公鑰，避免 helloworld 被鎖 (403 Forbidden)
                                    formData.append('apikey', 'K84523315788957'); 
                                    formData.append('language', 'cht');
                                    formData.append('isOverlayRequired', 'false');
                                    formData.append('base64Image', base64data);

                                    console.log(`[OCR 測試] 正在呼叫 OCR.space API...`);
                                    const responseText = await new Promise((resolve, reject) => {
                                        GM_xmlhttpRequest({
                                            method: 'POST',
                                            url: 'https://api.ocr.space/parse/image',
                                            data: formData,
                                            headers: {
                                                "Origin": "https://ocr.space",
                                                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
                                            },
                                            onload: function(r) { 
                                                if(r.status === 200) resolve(r.responseText); 
                                                else reject(`API Error ${r.status}: ${r.statusText}`); 
                                            },
                                            onerror: function(e) {
                                                reject(`Network Error: ${JSON.stringify(e)}`);
                                            }
                                        });
                                    });

                                    const result = JSON.parse(responseText);
                                    let text = "";
                                    if (result && result.ParsedResults && result.ParsedResults.length > 0) {
                                        text = result.ParsedResults[0].ParsedText || "";
                                    } else if (result.ErrorMessage) {
                                        console.log(`[OCR 測試] API 返回錯誤:`, result.ErrorMessage);
                                    }
                                    
                                    // 輸出 OCR 解析出的原始文字，方便 F12 除錯
                                    console.log(`[OCR 測試] 抓到的完整文字:\n`, text);
                                    
                                    window._processedOcrImages.add(img.src);

                                    const matchDate = text.includes(ocrDateKeyword) || text.replace(/\s/g, '').includes(ocrDateKeyword);
                                    const matchTime = ocrTimeKeyword === "" || text.includes(ocrTimeKeyword) || text.replace(/\s/g, '').includes(ocrTimeKeyword);

                                    if (matchDate && matchTime) {
                                        showStatus(`✅ OCR 成功辨識出 ${ocrDateKeyword} 且符合時段！點擊中...`, "green");
                                        if (clickElementCenter(img)) {
                                            hasClickedCoord = true;
                                            setTimeout(() => { hasClickedCoord = false; }, 3000);
                                        }
                                        found = true;
                                        break;
                                    } else {
                                        // 為了避免免費 API 呼叫過快被鎖 (rate limit)，每次掃描失敗等 1 秒
                                        await new Promise(r => setTimeout(r, 1000));
                                    }
                                } catch (err) {
                                    console.error("[OCR API 錯誤詳情]:", err);
                                    await new Promise(r => setTimeout(r, 1000));
                                }
                            }

                            if (!found) {
                                showStatus("⏳ OCR 掃描完畢，未找到相符日期的圖片，將持續掃描新圖片", "orange");
                            }

                            setTimeout(() => { window._isOcrRunning = false; }, 2000);

                        } catch (e) {
                            showStatus(`❌ OCR 發生錯誤: ${e.message || e}`, "red");
                            console.error(e);
                            setTimeout(() => { window._isOcrRunning = false; }, 2000);
                        }
                    })();
                }
            }
        }

    }, RUSH_POLLING_RATE);
})();