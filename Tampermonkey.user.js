// ==UserScript==
// @name         כפתורי צאט, העתקה, ושמירה להמשך בפורום אוצריא
// @namespace    http://tampermonkey.net/
// @version      3.0
// @description  הזרקת לחצן צ'אט מהיר ליד כל פוסט בפורום אוצריא והדבקת קישור הפוסט אוטומטית, הזרקת כפתורי העתקת קישור וקריאה בהמשך, והוספת רשימת קריאה בסרגל הצד
// @author       צדיק וטוב לו וההודי של gemini
// @match        https://otzaria.org/forum/*
// @updateURL    https://raw.githubusercontent.com/Tzadikvtovlo/Otzaria-QuickChat-Linker/main/Tampermonkey.user.js
// @downloadURL  https://raw.githubusercontent.com/Tzadikvtovlo/Otzaria-QuickChat-Linker/main/Tampermonkey.user.js
// @icon         https://www.google.com/s2/favicons?sz=64&domain=otzaria.org
// @grant        unsafeWindow
// @grant        GM_xmlhttpRequest
// @grant        GM_setValue
// @grant        GM_getValue
// @connect      mitmachim.top
// @connect      otzaria.org
// @run-at       document-end
// ==/UserScript==

(function() {
    'use strict';

    function getForumBaseUrl() {
        const relativePath = (unsafeWindow.config && unsafeWindow.config.relative_path) || '';
        return window.location.origin + relativePath;
    }

    let hideTimeout = null;
    let currentPid = null;
    const PREVIEW_HIDE_DELAY = 400;

    function getAuthorAvatar(containerElement) {
        if (!containerElement) return null;

        const header = containerElement.querySelector('.post-header, [component="post/header"], .topic-header, .post-meta');
        if (header) {
            const avatar = header.querySelector('[component="user/picture"], img.avatar, .avatar, a[href*="/user/"] > img, a[href*="/user/"] > .avatar');
            if (avatar) return avatar;
        }

        const avatars = containerElement.querySelectorAll('[component="user/picture"], img.avatar, .avatar, a[href*="/user/"] > img, a[href*="/user/"] > .avatar');
        for (let el of avatars) {
            if (!el.closest('blockquote') && !el.closest('.quote') && !el.closest('[component="post/content"]') && !el.closest('.content')) {
                return el;
            }
        }
        return null;
    }

    function cloneAndFormatAvatar(avatarEl, baseUrl, size = '30px', fontSize = '14px') {
        if (!avatarEl) return '';
        const clone = avatarEl.cloneNode(true);

        const fixUrlsAndStyles = (el) => {
            const realSrc = el.getAttribute('data-original') || el.getAttribute('data-src') || el.getAttribute('src');
            if (el.tagName === 'IMG' && realSrc) {
                try {
                    const absoluteUrl = new URL(realSrc, baseUrl).href;
                    el.setAttribute('src', absoluteUrl);
                    el.removeAttribute('data-original');
                    el.removeAttribute('data-src');
                    el.removeAttribute('srcset');
                    el.removeAttribute('loading');
                } catch(e) {}
            }

            if (el.style && el.style.backgroundImage && el.style.backgroundImage !== 'none') {
                const bgMatch = el.style.backgroundImage.match(/url\(['"]?(.*?)['"]?\)/);
                if (bgMatch && bgMatch[1] && !bgMatch[1].startsWith('http') && !bgMatch[1].startsWith('data:')) {
                    try {
                        const absoluteBg = new URL(bgMatch[1], baseUrl).href;
                        el.style.setProperty('background-image', `url("${absoluteBg}")`, 'important');
                    } catch(e) {}
                }
            }

            if (el.style && el.style.backgroundColor) {
                el.style.setProperty('background-color', el.style.backgroundColor, 'important');
            }
        };

        fixUrlsAndStyles(clone);
        clone.querySelectorAll('*').forEach(fixUrlsAndStyles);

        clone.style.cssText = `width: ${size} !important; height: ${size} !important; border-radius: 50% !important; display: inline-flex !important; align-items: center !important; justify-content: center !important; font-size: ${fontSize} !important; color: #fff !important; flex-shrink: 0 !important; text-decoration: none !important; margin: 0 !important; vertical-align: middle !important; overflow: hidden !important; border: 1px solid var(--bs-border-color, #eee) !important; background-color: var(--bs-secondary-bg, #f5f5f5);`;

        if (clone.tagName === 'IMG') {
            clone.style.setProperty('object-fit', 'cover', 'important');
        }

        const innerImg = clone.querySelector('img');
        if (innerImg) {
            innerImg.style.cssText = `width: 100% !important; height: 100% !important; border-radius: 50% !important; object-fit: cover !important; display: block !important;`;
        }

        if (clone.tagName !== 'IMG') {
            clone.style.setProperty('line-height', size, 'important');
            clone.style.setProperty('text-align', 'center', 'important');
            clone.style.setProperty('font-weight', 'bold', 'important');
        }

        return clone.outerHTML;
    }

    // ==========================================
    // חלק א': חלונית הפופ-אפ של קריאה בהמשך
    // ==========================================

    const sharedPopup = document.createElement('div');
    sharedPopup.id = 'shared-popup-container';
    sharedPopup.className = 'dropdown-menu dropdown-menu-end show';
    Object.assign(sharedPopup.style, {
        position: 'fixed',
        zIndex: '10050',
        display: 'none',
        width: '420px',
        maxHeight: '480px',
        overflowY: 'auto',
        padding: '0',
        direction: 'rtl',
        boxShadow: '0 4px 20px rgba(0,0,0,0.2)',
        border: '1px solid var(--bs-border-color)',
        borderRadius: '8px'
    });
    document.body.appendChild(sharedPopup);

    document.addEventListener('click', (e) => {
        if (sharedPopup.style.display !== 'none') {
            if (!sharedPopup.contains(e.target) && !e.target.closest('#integrated-to-read-li')) {
                sharedPopup.style.display = 'none';
            }
        }
    }, true);

    function positionPopup(anchorElement) {
        const rect = anchorElement.getBoundingClientRect();
        sharedPopup.style.left = `${rect.right + 10}px`;
        sharedPopup.style.top = `${rect.top}px`;
        sharedPopup.style.display = 'block';
    }

    function openReadLaterPopup(anchorElement) {
        positionPopup(anchorElement);
        const savedList = GM_getValue('saved_to_read_data', []);

        if (savedList.length === 0) {
            sharedPopup.innerHTML = '<div class="dropdown-item text-center text-muted" style="padding: 20px;">אין פוסטים שמורים לקריאה בהמשך.</div>';
            return;
        }

        sharedPopup.innerHTML = `
            <div class="dropdown-header d-flex justify-content-between align-items-center" style="background: var(--bs-tertiary-bg); border-bottom: 1px solid var(--bs-border-color); font-size: 14px; font-weight: bold; color: var(--bs-heading-color); padding: 12px 15px; position: sticky; top: 0; z-index: 10;">
                <span>רשימת קריאה בהמשך (${savedList.length})</span>
            </div>
            <ul class="list-unstyled mb-0" id="popup-items-container"></ul>
        `;
        const container = sharedPopup.querySelector('#popup-items-container');

        savedList.forEach(item => {
            const itemWrapper = document.createElement('li');
            const fullUrl = `${getForumBaseUrl()}/post/${item.pid}`;

            itemWrapper.innerHTML = `
                <div class="dropdown-item" style="padding: 12px 15px; border-bottom: 1px solid var(--bs-border-color); white-space: normal; cursor: default;">
                    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
                        <div style="display:flex; align-items:center; gap: 10px;">
                            ${item.avatarHtml || '<div style="width:30px; height:30px; border-radius:50%; background:var(--bs-secondary-bg); display:flex; align-items:center; justify-content:center; color:var(--bs-secondary-color);"><i class="fa fa-user"></i></div>'}
                            <div>
                                <a href="${fullUrl}" style="font-weight:600; color:var(--bs-link-color); font-size:14px; text-decoration:none; display:-webkit-box; -webkit-line-clamp:1; -webkit-box-orient:vertical; overflow:hidden;" target="_blank">${item.title}</a>
                                <div style="font-size:11px; color:var(--bs-secondary-color);">נכתב ע"י: <strong>${item.author}</strong></div>
                            </div>
                        </div>
                        <button class="delete-saved-btn btn btn-sm btn-link text-danger p-0" title="הסר מרשימת קריאה" style="z-index: 2; position: relative; margin-right: 10px;"><i class="fa fa-trash"></i></button>
                    </div>
                    <div style="font-size:13px; color:var(--bs-body-color); background: var(--bs-tertiary-bg); padding: 10px; border-radius: 6px; max-height: 150px; overflow-y: auto; overflow-x: hidden; border: 1px solid var(--bs-border-color-translucent); line-height: 1.4;">
                        ${item.content || item.snippet}
                    </div>
                </div>
            `;

            itemWrapper.querySelector('.delete-saved-btn').addEventListener('click', (e) => {
                e.preventDefault(); e.stopPropagation();
                let currentList = GM_getValue('saved_to_read_data', []);
                currentList = currentList.filter(x => x.pid !== item.pid);
                GM_setValue('saved_to_read_data', currentList);
                itemWrapper.remove();
                updateBadgesAndCounters();
                injectOrUpdatePostButtons();

                const headerSpan = sharedPopup.querySelector('.dropdown-header span');
                if (headerSpan) headerSpan.textContent = `רשימת קריאה בהמשך (${currentList.length})`;

                if (currentList.length === 0) {
                    sharedPopup.innerHTML = '<div class="dropdown-item text-center text-muted" style="padding: 20px;">אין פוסטים שמורים לקריאה בהמשך.</div>';
                }
            });
            container.appendChild(itemWrapper);
        });
    }

    // ==========================================
    // חלק ב': סרגל צד שמאלי ועדכון אייקון שעון חכם
    // ==========================================

    function updateBadgesAndCounters() {
        const readLaterCount = GM_getValue('saved_to_read_data', []).length;

        const sidebarIcon = document.querySelector('#integrated-to-read-li .fa-clock');
        if (sidebarIcon) {
            if (readLaterCount > 0) {
                sidebarIcon.classList.replace('fa-regular', 'fa-solid');
            } else {
                sidebarIcon.classList.replace('fa-solid', 'fa-regular');
            }
        }

        const rlBadge = document.getElementById('rl-count-badge');
        if (rlBadge) {
            rlBadge.textContent = readLaterCount;
            rlBadge.style.display = readLaterCount > 0 ? 'inline-block' : 'none';
        }
    }

    function integrateIntoLeftSidebar() {
        const lists = document.querySelectorAll('#main-nav, .sidebar-nav, [component^="sidebar/"] ul, .nav-list, #menu, #user-control-list');
        let leftSidebarNav = null;

        lists.forEach(el => {
            const rect = el.getBoundingClientRect();
            if (rect.width > 0 && rect.left < window.innerWidth / 2) {
                leftSidebarNav = el;
            }
        });

        if (!leftSidebarNav) return;

        if (!document.getElementById('integrated-to-read-li')) {
            const li = document.createElement('li');
            li.id = 'integrated-to-read-li';
            li.className = 'nav-item custom-sidebar-item';

            li.innerHTML = `
                <a class="nav-link" href="#" title="לקריאה בהמשך" style="cursor:pointer; display:flex; align-items:center; padding: 10px 15px; position:relative;">
                    <i class="fa fa-fw fa-regular fa-clock"></i>
                    <span class="nav-text" style="display:none; margin-right:10px;">לקריאה בהמשך</span>
                    <span id="rl-count-badge" class="custom-badge unread-count badge" style="display:none; position:absolute; top:2px; left:5px; background-color: var(--bs-primary, #0d6efd); color:white; font-size:10px; padding:3px 6px; border-radius:4px;">0</span>
                </a>
            `;
            li.querySelector('a').addEventListener('click', (e) => {
                e.preventDefault(); e.stopPropagation();
                if (sharedPopup.style.display === 'block') {
                    sharedPopup.style.display = 'none';
                } else {
                    openReadLaterPopup(li);
                }
            }, true);
            leftSidebarNav.appendChild(li);
        }

        updateBadgesAndCounters();
    }

    // ==========================================
    // חלק ג': הזרקת לחצני צ'אט, העתקה, וקריאה לפוסטים
    // ==========================================

    function injectOrUpdatePostButtons() {
        const posts = document.querySelectorAll('[component="post"]');
        const topicTitle = document.querySelector('[component="topic/title"]')?.textContent.trim() || 'נושא בפורום';
        const currentUid = (unsafeWindow.app && unsafeWindow.app.user) ? unsafeWindow.app.user.uid : null;
        let savedList = GM_getValue('saved_to_read_data', []);

        posts.forEach(post => {
            const actionsContainer = post.querySelector('[component="post/actions"]') || post.querySelector('.post-tools');
            if (!actionsContainer) return;

            const pid = post.getAttribute('data-pid');
            const postUid = post.getAttribute('data-uid');
            const authorName = post.getAttribute('data-username') || 'משתמש';

            let customToolsWrapper = post.querySelector('.custom-tools-wrapper');
            if (!customToolsWrapper) {
                customToolsWrapper = document.createElement('div');
                customToolsWrapper.className = 'custom-tools-wrapper';
                customToolsWrapper.style.cssText = 'display: inline-flex; flex-direction: row-reverse; gap: 14px; align-items: center; margin-right: 15px; font-size: 16px;';
                actionsContainer.insertBefore(customToolsWrapper, actionsContainer.firstChild);
            }

            const isSaved = savedList.some(x => x.pid === pid);
            let saveBtn = customToolsWrapper.querySelector('.custom-save-read-btn');

            if (!saveBtn && pid) {
                saveBtn = document.createElement('button');
                saveBtn.className = 'btn btn-link custom-save-read-btn';
                saveBtn.style.cssText = 'padding: 4px 8px; line-height: 1; border: none; background: transparent; cursor: pointer;';

                saveBtn.addEventListener('click', (e) => {
                    e.preventDefault(); e.stopPropagation();
                    let currentList = GM_getValue('saved_to_read_data', []);

                    if (currentList.some(x => x.pid === pid)) {
                        currentList = currentList.filter(x => x.pid !== pid);
                        saveBtn.setAttribute('title', 'שמור לקריאה בהמשך');
                        saveBtn.innerHTML = `<i class="fa fa-fw fa-regular fa-clock" style="pointer-events: none;"></i>`;
                    } else {
                        const contentEl = post.querySelector('[component="post/content"]');
                        let fullContent = contentEl ? contentEl.innerHTML : 'תוכן לא זמין';
                        let snippet = contentEl ? contentEl.innerText.trim().replace(/\s+/g, ' ').substring(0, 120) : '';

                        const avatarEl = getAuthorAvatar(post);
                        const baseUrl = window.location.href;
                        const avatarHtml = cloneAndFormatAvatar(avatarEl, baseUrl, '30px', '14px');

                        currentList.push({ pid: pid, title: topicTitle, author: authorName, content: fullContent, snippet: snippet, avatarHtml: avatarHtml });
                        saveBtn.setAttribute('title', 'בטל סימון לקריאה בהמשך');
                        saveBtn.innerHTML = `<i class="fa fa-fw fa-solid fa-clock" style="pointer-events: none;"></i>`;
                    }
                    GM_setValue('saved_to_read_data', currentList);
                    updateBadgesAndCounters();
                });
                customToolsWrapper.appendChild(saveBtn);
            }
            if (saveBtn) {
                const tooltipText = isSaved ? 'בטל סימון לקריאה בהמשך' : 'שמור לקריאה בהמשך';
                saveBtn.setAttribute('title', tooltipText);
                saveBtn.innerHTML = `<i class="fa fa-fw ${isSaved ? 'fa-solid' : 'fa-regular'} fa-clock" style="pointer-events: none;"></i>`;
            }

            // כפתור העתקת קישור עם הפיכה לאייקון מלא למשך 10 שניות
            let copyBtn = customToolsWrapper.querySelector('.custom-copy-link-btn');
            if (!copyBtn && pid) {
                copyBtn = document.createElement('button');
                copyBtn.className = 'btn btn-link custom-copy-link-btn';
                copyBtn.style.cssText = 'padding: 4px 8px; line-height: 1; border: none; background: transparent; cursor: pointer;';
                copyBtn.setAttribute('title', 'העתקת קישור');
                copyBtn.innerHTML = '<i class="fa fa-fw fa-regular fa-copy" style="pointer-events: none;"></i>';

                let copyTimer = null;
                copyBtn.addEventListener('click', (e) => {
                    e.preventDefault(); e.stopPropagation();
                    const postUrl = `${getForumBaseUrl()}/post/${pid}`;
                    navigator.clipboard.writeText(postUrl);

                    const icon = copyBtn.querySelector('i');
                    if (icon) {
                        icon.classList.replace('fa-regular', 'fa-solid');
                        clearTimeout(copyTimer);
                        copyTimer = setTimeout(() => {
                            icon.classList.replace('fa-solid', 'fa-regular');
                        }, 10000); // 10 שניות
                    }
                });
                customToolsWrapper.appendChild(copyBtn);
            }

            // כפתור צ'אט עם הפיכה לאייקון מלא למשך 20 שניות
            let chatBtn = customToolsWrapper.querySelector('.custom-chat-btn');
            if (!chatBtn && postUid && currentUid && Array.of(0, currentUid).includes(Number(postUid)) === false) {
                chatBtn = document.createElement('button');
                chatBtn.className = 'btn btn-link custom-chat-btn';
                chatBtn.style.cssText = 'padding: 4px 8px; line-height: 1; border: none; background: transparent; cursor: pointer;';
                chatBtn.setAttribute('title', 'פתיחת צאט');
                chatBtn.innerHTML = '<i class="fa fa-fw fa-regular fa-comment-dots" style="pointer-events: none;"></i>';

                let chatTimer = null;
                chatBtn.addEventListener('click', async function (e) {
                    e.preventDefault(); e.stopPropagation();

                    const icon = chatBtn.querySelector('i');
                    if (icon) {
                        icon.classList.replace('fa-regular', 'fa-solid');
                        clearTimeout(chatTimer);
                        chatTimer = setTimeout(() => {
                            icon.classList.replace('fa-solid', 'fa-regular');
                        }, 20000); // 20 שניות
                    }

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
                        const btn = popover.querySelector('[component="account/new-chat"]') ||
                                    popover.querySelector('[component="account/chat"]') ||
                                    popover.querySelector('a[href*="/chats"]');

                        if (btn) {
                            observer.disconnect();
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
                customToolsWrapper.appendChild(chatBtn);
            }
        });
    }

    // ==========================================
    // חלק ד': תצוגה מקדימה של פוסטים
    // ==========================================

    const previewPopup = document.createElement('div');
    Object.assign(previewPopup.style, {
        position: 'fixed',
        backgroundColor: '#ffffff',
        border: '1px solid #dddddd',
        borderRadius: '8px',
        padding: '12px',
        boxShadow: '0 4px 15px rgba(0,0,0,0.15)',
        zIndex: '10060',
        display: 'none',
        maxWidth: '400px',
        overflowY: 'auto',
        fontSize: '14px',
        direction: 'rtl',
        lineHeight: '1.5',
        color: '#333333'
    });
    document.body.appendChild(previewPopup);

    let activeRequest = null;

    previewPopup.addEventListener('mouseenter', () => {
        clearTimeout(hideTimeout);
    });

    previewPopup.addEventListener('mouseleave', (e) => {
        if (e.relatedTarget && (e.relatedTarget.closest('a[href*="/post/"]') || sharedPopup.contains(e.relatedTarget))) {
            return;
        }
        hideTimeout = setTimeout(() => {
            previewPopup.style.display = 'none';
            currentPid = null;
        }, PREVIEW_HIDE_DELAY);
    });

    function isInsideChat(link) {
        const path = window.location.pathname;
        if (path.includes('/chats') || /\/user\/[^/]+\/chats/.test(path)) return true;
        return !!link.closest('[component^="chat"]') ||
               !!link.closest('.chat-window') ||
               !!link.closest('.chat-modal') ||
               !!link.closest('.chat-messages') ||
               !!link.closest('.chat-content') ||
               !!link.closest('.expanded-chat');
    }

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
                        const finalUrlToUse = response.finalUrl || fullUrl;
                        const parser = new DOMParser();
                        const doc = parser.parseFromString(response.responseText, 'text/html');
                        const postContainer = doc.querySelector(`[data-pid="${pid}"]`) || doc.querySelector('[component="post"]');

                        let contentEl = null;
                        let author = 'משתמש';

                        if (postContainer) {
                            contentEl = postContainer.querySelector('.content') || postContainer.querySelector('[component="post/content"]');
                            author = postContainer.getAttribute('data-username') ||
                                     postContainer.querySelector('[component="post/author"]')?.textContent.trim() ||
                                     'משתמש';
                        } else {
                            contentEl = doc.querySelector('.content') || doc.querySelector('[component="post/content"]');
                            author = doc.querySelector('[component="post"]')?.getAttribute('data-username') || 'משתמש';
                        }

                        const avatarEl = getAuthorAvatar(postContainer || doc);
                        const avatarHtml = cloneAndFormatAvatar(avatarEl, finalUrlToUse, '24px', '12px');

                        resolve({
                            content: contentEl ? contentEl.innerHTML : 'לא ניתן ליצור תצוגה מקדימה של הפוסט כרגע.',
                            author: author,
                            avatarHtml: avatarHtml
                        });
                    } catch(e) {
                        resolve({ content: 'שגיאה בפענוח התצוגה המקדימה.', author: 'מערכת', avatarHtml: '' });
                    }
                }
            });
        });
    }

    document.body.addEventListener('mouseover', async (e) => {
        const link = e.target.closest('a[href*="/post/"]');

        if (link && link.closest('#shared-popup-container')) {
            return;
        }

        if (!link || !isInsideChat(link)) return;

        const match = link.href.match(/(mitmachim\.top|otzaria\.org).*?\/post\/(\d+)/);
        if (!match) return;

        clearTimeout(hideTimeout);
        const pid = match[2];

        if (currentPid === pid && previewPopup.style.display === 'block') {
            return;
        }

        currentPid = pid;
        const fullUrl = link.href;

        previewPopup.innerHTML = '<div style="padding: 10px; text-align: center;"><i class="fa fa-spinner fa-spin"></i> טוען תצוגה מקדימה...</div>';
        previewPopup.style.display = 'block';

        const updatePosition = () => {
            const rect = link.getBoundingClientRect();
            const spaceBelow = window.innerHeight - rect.bottom;
            const spaceAbove = rect.top;

            previewPopup.style.maxHeight = '280px';
            previewPopup.style.bottom = 'auto';
            const popupHeight = previewPopup.offsetHeight;

            let finalTop, finalMaxHeight;

            if (spaceBelow >= popupHeight + 10 || spaceBelow >= spaceAbove) {
                finalTop = rect.bottom + 5;
                finalMaxHeight = Math.min(280, spaceBelow - 15);
            } else {
                finalMaxHeight = Math.min(280, spaceAbove - 15);
                const actualHeight = Math.min(popupHeight, finalMaxHeight);
                finalTop = rect.top - actualHeight - 5;
            }

            previewPopup.style.maxHeight = `${finalMaxHeight}px`;
            previewPopup.style.top = `${finalTop}px`;

            const popupWidth = previewPopup.offsetWidth || 400;
            let finalLeft = rect.left;
            if (finalLeft + popupWidth > window.innerWidth) {
                finalLeft = window.innerWidth - popupWidth - 15;
            }
            previewPopup.style.left = `${Math.max(10, finalLeft)}px`;
        };

        updatePosition();

        const data = await fetchPostContent(fullUrl, pid);
        if (!data || currentPid !== pid) return;

        previewPopup.innerHTML = `
            <div style="font-weight: bold; color: var(--bs-link-color); margin-bottom: 8px; display: flex; align-items: center; border-bottom: 1px solid var(--bs-border-color); padding-bottom: 5px; position: sticky; top: -12px; background: #ffffff; z-index: 2; margin-top: -12px; padding-top: 12px;">
                ${data.avatarHtml || '<div style="margin-left: 8px; width: 24px; height: 24px; border-radius: 50%; background: #eee; display: flex; align-items: center; justify-content: center;"><i class="fa fa-user" style="font-size: 12px; color: #aaa;"></i></div>'}
                <span>${data.author}:</span>
            </div>
            <div class="post-preview-body" style="font-size: 13px;">${data.content}</div>
        `;

        updatePosition();
    });

    document.body.addEventListener('mouseout', (e) => {
        const link = e.target.closest('a[href*="/post/"]');
        if (link && isInsideChat(link)) {
            if (e.relatedTarget && (previewPopup.contains(e.relatedTarget) || sharedPopup.contains(e.relatedTarget))) {
                return;
            }
            hideTimeout = setTimeout(() => {
                if (activeRequest) { try { activeRequest.abort(); } catch(e){} }
                previewPopup.style.display = 'none';
                currentPid = null;
            }, PREVIEW_HIDE_DELAY);
        }
    });

    // ==========================================
    // חלק ה': הפעלת המנגנונים
    // ==========================================

    integrateIntoLeftSidebar();
    injectOrUpdatePostButtons();

    let debounceTimer;
    const domObserver = new MutationObserver(() => {
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
            integrateIntoLeftSidebar();
            injectOrUpdatePostButtons();
        }, 150);
    });

    domObserver.observe(document.body, { childList: true, subtree: true });

})();
