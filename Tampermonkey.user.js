// ==UserScript==
// @name         כפתור צאט אוצריא
// @namespace    http://tampermonkey.net/
// @version      1.1
// @description  הזרקת לחצן צ'אט מהיר ליד כל פוסט בפורום אוצריא והדבקת קישור הפוסט אוטומטית
// @author       צדיק וטוב לו וההודי של gemini
// @match        https://otzaria.org/forum/*
// @updateURL    https://raw.githubusercontent.com/Tzadikvtovlo/Otzaria-QuickChat-Linker/main/Tampermonkey.user.js
// @downloadURL  https://raw.githubusercontent.com/Tzadikvtovlo/Otzaria-QuickChat-Linker/main/Tampermonkey.user.js
// @grant        unsafeWindow
// @run-at       document-end
// ==/UserScript==

(function() {
    'use strict';

    // פונקציה להזרקת הכפתור לפוסטים שעוד לא טופלו
    function injectChatButtons() {
        // בדיקה שפתח ה-API של הפורום זמין
        if (!unsafeWindow.app || !unsafeWindow.app.user) return;

        const currentUid = unsafeWindow.app.user.uid;

        // שליפת כל הפוסטים בעמוד שעוד לא קיבלו כפתור
        const posts = document.querySelectorAll('[component="post"]:not(.chat-btn-added)');

        posts.forEach(post => {
            post.classList.add('chat-btn-added');

            const postUid = post.getAttribute('data-uid');

            // הגנה: שלא יוצג כפתור צ'אט של המשתמש עם עצמו, או אם אין uid תקין
            if (!postUid || Array.of(0, currentUid).includes(Number(postUid))) return;

            // איתור מיקום הלחצנים של הפוסט (תומך ברוב ערכות הנושא של NodeBB)
            const actionsContainer = post.querySelector('[component="post/actions"]') || post.querySelector('.post-tools');

            if (actionsContainer) {
                const chatBtn = document.createElement('a');
                chatBtn.className = 'btn btn-xs btn-link chat-quick-btn';
                chatBtn.innerHTML = '<i class="fa fa-fw fa-comment-dots"></i> צ\'אט';
                chatBtn.style.marginLeft = '8px';
                chatBtn.style.cursor = 'pointer';

                // אירוע לחיצה לפתיחת הצ'אט המובנה של המערכת
                chatBtn.addEventListener('click', async function (e) {
                    e.preventDefault();
                    e.stopPropagation();

                    const userLink = post.querySelector('a[data-uid]');
                    if (!userLink) return;

                    // ניסיון לפתוח את ה-popover המקורי
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

                            // חילוץ מזהה הפוסט ויצירת קישור ישיר אליו
                            const pid = post.getAttribute('data-pid');
                            const postUrl = pid ? `${window.location.origin}/forum/post/${pid}` : window.location.href;

                            // האזנה לפתיחת חלונית הצ'אט והופעת תיבת הקלט
                            const chatInputObserver = new MutationObserver(() => {
                                const chatInput = document.querySelector('[component="chat/input"]') || document.querySelector('.chat-input');

                                if (chatInput) {
                                    chatInputObserver.disconnect();

                                    // הזנת הקישור רק אם הוא לא קיים כבר בתיבה
                                    if (!chatInput.value.includes(postUrl)) {
                                        chatInput.value = postUrl + '\n' + chatInput.value;

                                        // שיגור אירועים כדי לעדכן את מערכת ה-Framework של NodeBB
                                        chatInput.dispatchEvent(new Event('input', { bubbles: true }));
                                        chatInput.dispatchEvent(new Event('change', { bubbles: true }));
                                        chatInput.focus();
                                    }
                                }
                            });

                            chatInputObserver.observe(document.body, {
                                childList: true,
                                subtree: true
                            });

                            // הגבלת זמן לחיפוש תיבת הצ'אט ל-5 שניות
                            setTimeout(() => chatInputObserver.disconnect(), 5000);

                            // לחיצה על כפתור פתיחת הצ'אט
                            btn.click();
                        }
                    });

                    observer.observe(document.body, {
                        childList: true,
                        subtree: true
                    });

                    setTimeout(() => observer.disconnect(), 5000);
                });

                // הזרקה לתחילת או סוף רשימת הלחצנים לפי הנוחיות
                actionsContainer.appendChild(chatBtn);
            }
        });
    }

    // האזנה לשינויים ב-DOM לצורך תמיכה בגלילה אינסופית ומעברי עמודים דינמיים
    const observer = new MutationObserver(() => {
        injectChatButtons();
    });

    observer.observe(document.body, {
        childList: true,
        subtree: true
    });

    // הרצה ראשונית בטעינת העמוד
    injectChatButtons();
})();
