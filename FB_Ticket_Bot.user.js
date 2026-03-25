// ==UserScript==
// @name         排球輕鬆玩-自動留言機器人 (V21.2 視覺版)
// @namespace    http://tampermonkey.net/
// @version      21.2
// @description  專為排球輕鬆玩設計，全自動 OCR 辨識相簿並搶留言
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
    const DEFAULT_OCR_DATE = DEFAULT_KEYWORD;
    const DEFAULT_OCR_TIME = "19:00";

    const MONITOR_REFRESH_RATE = 1500;
    const RUSH_POLLING_RATE = 100;
    // =================================================

    const storage = localStorage;
    const KEY_MONITOR_ON = "FB_MONITOR_ACTIVE";
    const KEY_RUSH_ON = "FB_RUSH_ACTIVE";
    const KEY_TARGET_NAME = "FB_TARGET_NAME";
    const KEY_TARGET_FILTER = "FB_TARGET_FILTER"; 
    const KEY_SIGN_TEXT = "FB_SIGN_TEXT";         
    const KEY_TARGET_TIME = "FB_TARGET_TIME";     
    const KEY_REFRESH_RATE = "FB_REFRESH_RATE";   
    const KEY_PANEL_LEFT = "FB_PANEL_LEFT";       
    const KEY_PANEL_TOP = "FB_PANEL_TOP";         

    // 新增辨識模式參數
    const KEY_OCR_DATE = "FB_OCR_DATE";           // OCR 辨識的日期關鍵字
    const KEY_OCR_TIME = "FB_OCR_TIME";           // OCR 辨識的時段關鍵字

    let isActionTriggered = false;

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
                <span>🤖 排球輕鬆玩-自動留言機器人</span>
                <div>
                    <span id="panel-status" style="color: ${isMon ? '#00E676' : (isRush ? '#FFEA00' : '#B0BEC5')}; margin-right: 5px;">●</span>
                    <button id="btn-close-panel" style="background:none; border:none; color:white; font-weight:bold; cursor:pointer; font-size:14px; padding:0 5px;" title="關閉控制面板">✖</button>
                </div>
            </div>
            <div style="padding: 15px;">
                <div id="ocr-settings" style="padding: 10px; background: rgba(0,188,212,0.1); border-radius: 4px; border: 1px dashed #00BCD4; margin-bottom: 8px;">
                    <div style="display: flex; align-items: center; margin-bottom: 5px;">
                        <label style="flex:1; color:#00BCD4;">辨識日期關鍵字:</label>
                        <input type="text" id="inp-ocr-date" value="${DEFAULT_OCR_DATE}" style="width: 140px; padding: 4px; background: #333; border: 1px solid #00BCD4; color: white; border-radius: 4px;">
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
                    <input type="text" id="inp-keyword" value="${DEFAULT_KEYWORD}" style="width: 160px; padding: 4px; background: #424242; border: 1px solid #616161; color: white; border-radius: 4px;">
                </div>
                <div style="margin-bottom: 8px; display: flex; align-items: center;">
                    <label style="flex:1;">相簿地點濾鏡:</label>
                    <input type="text" id="inp-filter" value="${getVal(KEY_TARGET_FILTER, DEFAULT_FILTER)}" style="width: 160px; padding: 4px; background: #424242; border: 1px solid #616161; color: white; border-radius: 4px;">
                </div>
                <div style="margin-bottom: 8px; display: flex; align-items: center;">
                    <label style="flex:1;">留言內容:</label>
                    <input type="text" id="inp-text" value="${getVal(KEY_SIGN_TEXT, DEFAULT_SIGN_UP_TEXT)}" style="width: 160px; padding: 4px; background: #424242; border: 1px solid #616161; color: white; border-radius: 4px;">
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
            panel.remove();
            showStatus("🛑 搶票腳本已手動關閉。", "#D32F2F");
        });

        // 事件綁定
        const inputs = ['inp-time', 'inp-keyword', 'inp-filter', 'inp-text', 'inp-ocr-date', 'inp-ocr-time'];
        const keys = [KEY_TARGET_TIME, KEY_TARGET_NAME, KEY_TARGET_FILTER, KEY_SIGN_TEXT, KEY_OCR_DATE, KEY_OCR_TIME];

        inputs.forEach((id, idx) => {
            document.getElementById(id).addEventListener('input', (e) => {
                storage.setItem(keys[idx], e.target.value);
            });
        });

        document.getElementById('btn-monitor').onclick = function() {
            const current = storage.getItem(KEY_MONITOR_ON) === "true";
            if (current) {
                storage.setItem(KEY_MONITOR_ON, "false");
                this.innerText = "▶ 啟動監控";
                this.style.background = "#2E7D32";
                updateStatusLight();
                showStatus("🛑 監控已停止", "#757575");
            } else {
                storage.setItem(KEY_MONITOR_ON, "true");
                storage.setItem(KEY_RUSH_ON, "false"); 
                this.innerText = "⏹ 停止監控";
                this.style.background = "#D32F2F";
                updateStatusLight();
                
                // 重設內部監控狀態
                window._lastReloadTime = 0;
                window._isOcrRunning = false;
                window._processedOcrImages = new Set();
                showStatus("🛰️ 監控啟動中...", "#0D47A1");
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
            showStatus(`⚠️ 點擊位置無效 (背景)`, "red");
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
        const ocrDateKeyword = storage.getItem(KEY_OCR_DATE) || DEFAULT_OCR_DATE;
        const ocrTimeKeyword = storage.getItem(KEY_OCR_TIME) || DEFAULT_OCR_TIME;

        // 1. 監控模式
        if (isMonitorMode && url.includes("/media")) {
            const targetTimeStr = storage.getItem(KEY_TARGET_TIME);
            const now = new Date();

            if (targetTimeStr) {
                const [tH, tM] = targetTimeStr.split(':').map(Number);
                // 每次循環都重新構建當前的目標時間點
                const targetDate = new Date(now.getFullYear(), now.getMonth(), now.getDate(), tH, tM, 0, 0);
                
                // 核心邏輯：如果現在時間還沒到設定時間
                if (now < targetDate) {
                    const diffMs = targetDate - now;
                    const diffSec = Math.ceil(diffMs / 1000);
                    showStatus(`⏳ 監控中... 剩餘 ${diffSec} 秒 [目標 ${targetTimeStr}]`, "#FF9800");
                    return; 
                }
            }

            // --- 時間已到，執行搜尋邏輯 ---
            showStatus(`🔍 時間已到 (${targetTimeStr})！正在搜尋目標...`, "#0D47A1");
            const targetEl = fuzzyFindAlbum(targetName, targetFilter);
            
            if (targetEl) {
                targetEl.style.border = "5px solid blue";
                targetEl.style.boxShadow = "0 0 15px blue";
                const validUrl = extractValidUrl(targetEl);

                if (validUrl) {
                    showStatus(`✅ 鎖定目標！跳轉中...`, "blue");
                    storage.setItem(KEY_MONITOR_ON, "false");
                    storage.setItem(KEY_RUSH_ON, "true");
                    window.location.href = validUrl;
                } else {
                    showStatus(`⚠️ 找到目標但無連結，嘗試模擬點擊`, "orange");
                    storage.setItem(KEY_MONITOR_ON, "false");
                    storage.setItem(KEY_RUSH_ON, "true");
                    targetEl.click();
                }
            } else {
                // 如果時間到了但沒找到目標，則定期重新整理
                if (!window._lastReloadTime || (Date.now() - window._lastReloadTime > MONITOR_REFRESH_RATE)) {
                    window._lastReloadTime = Date.now();
                    showStatus(`🔍 未發現目標，重新整理中...`, "#555");
                    window.location.reload();
                }
            }
            return;
        }

        // 2. 搶票模式
        if (isRushMode) {
            const photoDialog = document.querySelector('div[role="dialog"]');
            const isViewingPhoto = (photoDialog && photoDialog.offsetParent !== null) && (url.includes("photo") || url.includes("fbid="));
            const isInAlbum = (url.includes("/set/") || url.includes("set=")) && !isViewingPhoto;

            if (!isInAlbum && !isViewingPhoto) {
                showStatus("⏳ 正在前往相簿...", "orange");
                return;
            }

            if (isViewingPhoto) {
                const inputs = photoDialog.querySelectorAll('div[role="textbox"][data-lexical-editor="true"], div[contenteditable="true"][role="textbox"]');
                if (inputs.length > 0) {
                    const target = inputs[inputs.length - 1];
                    if (target.offsetParent !== null && !target.innerText.includes(signUpText.split(' ')[0])) {
                        showStatus("✍️ 寫入留言...", "blue");
                        fastInput(target, signUpText);
                        setTimeout(() => {
                            if (target.innerText.length > 0) {
                                fastEnter(target);
                                showStatus("✅ 完成！", "#388E3C");
                                storage.removeItem(KEY_RUSH_ON);
                                storage.removeItem(KEY_MONITOR_ON);
                            }
                        }, 100);
                        return;
                    }
                } else {
                    showStatus("👀 等待留言框載入...", "teal");
                }
            } 
            else if (isInAlbum) {
                if (isActionTriggered) return; 

                // --- 影像文字辨識 (OCR) ---
                if (window._isOcrRunning) return; 
                
                let images = Array.from(document.querySelectorAll('img')).filter(img => {
                    const rect = img.getBoundingClientRect();
                    return rect.width > 50 && rect.height > 50 && img.src && !img.src.includes('emoji');
                });

                images = images.slice(0, 5);
                if (images.length === 0) return;

                window._isOcrRunning = true;
                
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
                    targetElement.click(); 
                    let parentA = targetElement.closest('a');
                    if(parentA) parentA.click();
                    
                    if (clickElementCenter(targetElement)) {
                        isActionTriggered = true;
                        setTimeout(() => { isActionTriggered = false; }, 3000);
                    }
                    window._isOcrRunning = false;
                    return;
                }

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
                                const blob = await fetchImageBlob(img.src);
                                if (!blob) throw new Error("Fetch blob failed");

                                const reader = new FileReader();
                                const base64data = await new Promise((res, rej) => {
                                    reader.onloadend = () => res(reader.result);
                                    reader.onerror = () => rej(reader.error);
                                    reader.readAsDataURL(blob);
                                });

                                const formData = new FormData();
                                formData.append('apikey', 'K84523315788957'); 
                                formData.append('language', 'cht');
                                formData.append('isOverlayRequired', 'false');
                                formData.append('base64Image', base64data);

                                const responseText = await new Promise((resolve, reject) => {
                                    GM_xmlhttpRequest({
                                        method: 'POST',
                                        url: 'https://api.ocr.space/parse/image',
                                        data: formData,
                                        headers: {
                                            "Origin": "https://ocr.space",
                                            "User-Agent": "Mozilla/5.0"
                                        },
                                        onload: function(r) { 
                                            if(r.status === 200) resolve(r.responseText); 
                                            else reject(`API Error ${r.status}`); 
                                        },
                                        onerror: function(e) { reject(`Network Error`); }
                                    });
                                });

                                const result = JSON.parse(responseText);
                                let text = (result?.ParsedResults?.[0]?.ParsedText || "").replace(/\s/g, '');
                                window._processedOcrImages.add(img.src);

                                const matchDate = text.includes(ocrDateKeyword.replace(/\s/g, ''));
                                const matchTime = ocrTimeKeyword === "" || text.includes(ocrTimeKeyword.replace(/\s/g, ''));

                                if (matchDate && matchTime) {
                                    showStatus(`✅ OCR 辨識成功！${ocrDateKeyword}`, "green");
                                    if (clickElementCenter(img)) {
                                        isActionTriggered = true;
                                        setTimeout(() => { isActionTriggered = false; }, 3000);
                                    }
                                    found = true;
                                    break;
                                } else {
                                    await new Promise(r => setTimeout(r, 800));
                                }
                            } catch (err) {
                                await new Promise(r => setTimeout(r, 800));
                            }
                        }
                        if (!found) showStatus("⏳ OCR 尚未發現目標日期", "orange");
                        setTimeout(() => { window._isOcrRunning = false; }, 1500);
                    } catch (e) {
                        showStatus(`❌ OCR 異常`, "red");
                        setTimeout(() => { window._isOcrRunning = false; }, 1500);
                    }
                })();
            }
        }
    }, RUSH_POLLING_RATE);
})();