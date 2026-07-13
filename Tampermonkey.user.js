// ==UserScript==
// @name         כפתור צאט אוצריא
// @namespace    http://tampermonkey.net/
// @version      2.0
// @description  הזרקת לחצן צ'אט מהיר ליד כל פוסט בפורום אוצריא והדבקת קישור הפוסט אוטומטית
// @author       צדיק וטוב לו וההודי של gemini
// @match        https://otzaria.org/forum/*
// @updateURL    https://raw.githubusercontent.com/Tzadikvtovlo/Otzaria-QuickChat-Linker/main/Tampermonkey.user.js
// @downloadURL  https://raw.githubusercontent.com/Tzadikvtovlo/Otzaria-QuickChat-Linker/main/Tampermonkey.user.js
// @icon         https://www.google.com/s2/favicons?sz=64&domain=otzaria.org
// @grant        unsafeWindow
// @grant        GM_xmlhttpRequest
// @connect      mitmachim.top
// @connect      otzaria.org
// @run-at       document-end
// ==/UserScript==

(function() {
    'use strict';

    // פונקציה לקבלת כתובת הבסיס הדינמית של הפורום (כולל תת-נתיב כמו /forum אם קיים)
    function getForumBaseUrl() {
        const relativePath = (unsafeWindow.config && unsafeWindow.config.relative_path) || '';
        return window.location.origin + relativePath;
    }

    // ==========================================
    // חלק א': הזרקת לחצן צ'אט מהיר והדבקת הקישור
    // ==========================================

    function injectChatButtons() {
        if (!unsafeWindow.app || !unsafeWindow.app.user) return;
        const currentUid = unsafeWindow.app.user.uid;

        const posts = document.querySelectorAll('[component="post"]:not(.chat-btn-added)');

        posts.forEach(post => {
            post.classList.add('chat-btn-added');
            const postUid = post.getAttribute('data-uid');

            if (!postUid || Array.of(0, currentUid).includes(Number(postUid))) return;

            const actionsContainer = post.querySelector('[component="post/actions"]') || post.querySelector('.post-tools');

            if (actionsContainer) {
                const chatBtn = document.createElement('a');
                chatBtn.className = 'btn btn-xs btn-link chat-quick-btn';
                chatBtn.innerHTML = '<i class="fa fa-fw fa-comment-dots"></i> צ\'אט';
                chatBtn.style.marginLeft = '8px';
                chatBtn.style.cursor = 'pointer';

                chatBtn.addEventListener('click', async function (e) {
                    e.preventDefault();
                    e.stopPropagation();

                    const userLink = post.querySelector('a[data-uid]');
                    if (!userLink) return;

                    userLink.dispatchEvent(new PointerEvent('pointerenter', { bubbles: true }));
                    userLink.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
                    userLink.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));

                    const observer = new MutationObserver(() => {
                        const popoverId = userLink.getAttribute('aria-describedby');
                        if (!popoverId) return;

                        const popover = document.getElementById(popoverId);
                        if (!popover) return;

                        const btn =
                            popover.querySelector('[component="account/new-chat"]') ||
                            popover.querySelector('[component="account/chat"]') ||
                            popover.querySelector('a[href*="/chats"]');

                        if (btn) {
                            observer.disconnect();

                            const pid = post.getAttribute('data-pid');
                            const postUrl = pid ? `${getForumBaseUrl()}/post/${pid}` : window.location.href;

                            const chatInputObserver = new MutationObserver(() => {
                                const chatInput = document.querySelector('[component="chat/input"]') || document.querySelector('.chat-input');
                                
                                if (chatInput) {
                                    chatInputObserver.disconnect();

                                    if (!chatInput.value.includes(postUrl)) {
                                        chatInput.value = postUrl + '\n' + chatInput.value;
                                        chatInput.dispatchEvent(new Event('input', { bubbles: true }));
                                        chatInput.dispatchEvent(new Event('change', { bubbles: true }));
                                        chatInput.focus();
                                    }
                                }
                            });

                            chatInputObserver.observe(document.body, { childList: true, subtree: true });
                            setTimeout(() => chatInputObserver.disconnect(), 5000);

                            btn.click();
                        }
                    });

                    observer.observe(document.body, { childList: true, subtree: true });
                    setTimeout(() => observer.disconnect(), 5000);
                });

                actionsContainer.appendChild(chatBtn);
            }
        });
    }

    // ==========================================
    // חלק ב': תצוגה מקדימה של פוסטים באזורי צ'אט
    // ==========================================

    const previewPopup = document.createElement('div');
    Object.assign(previewPopup.style, {
        position: 'absolute',
        backgroundColor: '#ffffff',
        border: '1px solid #dddddd',
        borderRadius: '8px',
        padding: '12px',
        boxShadow: '0 4px 15px rgba(0,0,0,0.15)',
        zIndex: '10000',
        display: 'none',
        maxWidth: '400px',
        maxHeight: '300px',
        overflowY: 'auto',
        fontSize: '14px',
        direction: 'rtl',
        lineHeight: '1.5',
        color: '#333333'
    });
    document.body.appendChild(previewPopup);

    let activeRequest = null;
    let hideTimeout = null;

    // שיפור 1: האזנה לכניסה ויציאה מהחלונית עצמה כדי לשמור עליה פתוחה ולאפשר גלילה
    previewPopup.addEventListener('mouseenter', () => {
        clearTimeout(hideTimeout);
    });

    previewPopup.addEventListener('mouseleave', () => {
        previewPopup.style.display = 'none';
    });

    function isInsideChat(link) {
        const path = window.location.pathname;
        if (path.includes('/chats') || /\/user\/[^/]+\/chats/.test(path)) {
            return true;
        }
        return !!link.closest('[component^="chat"]') || 
               !!link.closest('.chat-window') || 
               !!link.closest('.chat-modal') || 
               !!link.closest('.chat-messages') || 
               !!link.closest('.chat-content') ||
               !!link.closest('.expanded-chat');
    }

    // שיפור 2: מעבר ל-GM_xmlhttpRequest המאפשר שליפת נתונים בין שני האתרים ללא חסימות
    function fetchPostContent(fullUrl, pid) {
        return new Promise((resolve) => {
            if (activeRequest) {
                try { activeRequest.abort(); } catch(e){}
            }

            activeRequest = GM_xmlhttpRequest({
                method: "GET",
                url: fullUrl,
                onload: function(response) {
                    try {
                        const parser = new DOMParser();
                        const doc = parser.parseFromString(response.responseText, 'text/html');
                        const postContainer = doc.querySelector(`[data-pid="${pid}"]`);
                        
                        let contentEl = null;
                        let authorEl = null;
                        let avatarEl = null;

                        if (postContainer) {
                            contentEl = postContainer.querySelector('.content') || 
                                        postContainer.querySelector('[component="post/content"]') || 
                                        postContainer.querySelector('.post-content');
                                        
                            authorEl = postContainer.querySelector('[component="post/author"]') || 
                                       postContainer.querySelector('.username') || 
                                       postContainer.querySelector('[component="user/username"]') ||
                                       postContainer.querySelector('.author-name') ||
                                       postContainer.querySelector('[data-username]');

                            // שיפור 3: שליפת אלמנט האוואטר/תמונת הפרופיל של הכותב
                            avatarEl = postContainer.querySelector('.avatar') || 
                                       postContainer.querySelector('[component="user/picture"]') || 
                                       postContainer.querySelector('.user-img') || 
                                       postContainer.querySelector('.author-avatar') ||
                                       postContainer.querySelector('.avatar-wrapper');
                        } else {
                            contentEl = doc.querySelector('.content') || doc.querySelector('[component="post/content"]');
                            authorEl = doc.querySelector('.username') || doc.querySelector('[component="post/author"]');
                            avatarEl = doc.querySelector('.avatar') || doc.querySelector('[component="user/picture"]');
                        }

                        // עיבוד והתאמת גודל תמונת הפרופיל (עובד גם עם תמונות וגם עם אותיות ראשוניות של הפורום)
                        let avatarHtml = '';
                        if (avatarEl) {
                            const clone = avatarEl.cloneNode(true);
                            clone.style.width = '24px';
                            clone.style.height = '24px';
                            clone.style.borderRadius = '50%';
                            clone.style.marginLeft = '8px';
                            clone.style.display = 'inline-block';
                            clone.style.verticalAlign = 'middle';
                            clone.style.objectFit = 'cover';
                            clone.style.lineHeight = '24px';
                            clone.style.fontSize = '11px';
                            avatarHtml = clone.outerHTML;
                        }

                        resolve({
                            content: contentEl ? contentEl.innerHTML : 'לא ניתן ליצור תצוגה מקדימה של הפוסט כרגע.', 
                            author: authorEl ? (authorEl.getAttribute('data-username') || authorEl.textContent.trim()) : 'משתמש',
                            avatarHtml: avatarHtml
                        });
                    } catch(e) {
                        resolve({ content: 'שגיאה בפענוח התצוגה המקדימה.', author: 'מערכת', avatarHtml: '' });
                    }
                },
                onerror: function() {
                    resolve({ content: 'שגיאה בטעינת התצוגה המקדימה.', author: 'מערכת', avatarHtml: '' });
                }
            });
        });
    }

    document.body.addEventListener('mouseover', async (e) => {
        const link = e.target.closest('a[href*="/post/"]');
        if (!link || !isInsideChat(link)) return;

        // שיפור 2: סינון חכם של הכתובת - יפעל אך ורק עבור לינקים ממתמחים טופ או מאוצריא
        const match = link.href.match(/(mitmachim\.top|otzaria\.org).*?\/post\/(\d+)/);
        if (!match) return;

        clearTimeout(hideTimeout); // מניעת סגירה אם עברנו מהר בין קישורים

        const pid = match[2];
        const fullUrl = link.href;

        const rect = link.getBoundingClientRect();
        previewPopup.style.left = `${rect.left + window.scrollX}px`;
        previewPopup.style.top = `${rect.bottom + window.scrollY + 8}px`;
        previewPopup.innerHTML = '<i class="fa fa-spinner fa-spin"></i> טוען תצוגה מקדימה...';
        previewPopup.style.display = 'block';

        const data = await fetchPostContent(fullUrl, pid);
        if (!data) return;

        // שיפור 3: שילוב תמונת הפרופיל במבנה ה-HTML של הפופאפ
        previewPopup.innerHTML = `
            <div style="font-weight: bold; color: #007bff; margin-bottom: 8px; display: flex; align-items: center;">
                ${data.avatarHtml || '<i class="fa fa-user" style="margin-left: 8px;"></i>'} 
                <span>${data.author}:</span>
            </div>
            <div class="post-preview-body">${data.content}</div>
        `;
    });

    document.body.addEventListener('mouseout', (e) => {
        const link = e.target.closest('a[href*="/post/"]');
        if (link && isInsideChat(link)) {
            // שיפור 1: במקום לסגור מיד, נותנים השהיה קלה של 300 מילישניות כדי לאפשר לעכבר לעבור לחלונית
            hideTimeout = setTimeout(() => {
                if (activeRequest) {
                    try { activeRequest.abort(); } catch(e){}
                }
                previewPopup.style.display = 'none';
            }, 300);
        }
    });

    // ==========================================
    // חלק ג': הפעלה והאזנה לשינויי DOM
    // ==========================================

    const domObserver = new MutationObserver(() => {
        injectChatButtons();
    });

    domObserver.observe(document.body, { childList: true, subtree: true });
    injectChatButtons();
})();
