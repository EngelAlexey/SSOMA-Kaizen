const isLocal = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
const API_BASE = isLocal ? 'http://127.0.0.1:3000' : 'https://ssoma-kaizen-api.onrender.com';
const API_URL = `${API_BASE}/chat/query`;
const LOGIN_URL = `${API_BASE}/auth/login`;

let currentFiles = [];
let sessions = loadStoredSessions();
let activeSessionId = null;
let modalResolver = null;

function loadStoredSessions() {
    const suffix = getStorageKeySuffix();
    const raw = localStorage.getItem(`kaizen_sessions_${suffix}`);
    if (!raw) return [];
    try {
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : [];
    } catch (e) {
        const suffix2 = getStorageKeySuffix();
        localStorage.removeItem(`kaizen_sessions_${suffix2}`);
        localStorage.removeItem(`KAIZEN_LAST_CHAT_ID_${suffix2}`);
        return [];
    }
}

function loadStoredUser() {
    const raw = localStorage.getItem('kaizen_user');
    if (!raw) return null;

    try {
        const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
        if (parsed && typeof parsed === 'object') {
            return {
                usName: parsed.usName || parsed.name || 'Invitado',
                prefix: parsed.prefix,
                usLicense: parsed.usLicense || parsed.license || parsed.usLicence,
                organization: parsed.organization || parsed.org
            };
        }
    } catch (e) {
        localStorage.removeItem('kaizen_user');
    }
    return null;
}

function loadStoredPrefix() {
    return localStorage.getItem('kaizen_prefix') || null;
}


function getStorageKeySuffix() {
    const raw = localStorage.getItem('ssoma_user') || localStorage.getItem('kaizen_user');
    let licensePart = 'NOUSER';
    if (raw) {
        try {
            const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
            if (parsed && typeof parsed === 'object') {
                licensePart = parsed.usLicense || parsed.id || parsed.prefix || parsed.usName || parsed.name || 'NOUSER';
            } else if (typeof raw === 'string') {
                licensePart = raw;
            }
        } catch (e) {
            licensePart = raw;
        }
    }
    const prefix = localStorage.getItem('kaizen_prefix') || localStorage.getItem('ssoma_prefix') || 'NOPREFIX';
    return `${licensePart}_${prefix}`;
}

let currentUser = loadStoredUser();
let currentPrefix = loadStoredPrefix();

const input = document.getElementById('input');
const sendBtn = document.getElementById('sendBtn');
const messagesDiv = document.getElementById('messages');
const fileInput = document.getElementById('fileInput');
const attachFloat = document.getElementById('attachFloat');
const afName = document.getElementById('afName');
const afSize = document.getElementById('afSize');
const afClose = document.getElementById('afClose');
const convList = document.getElementById('convList');
const btnNewChat = document.getElementById('btnNewChat');
const emptyState = document.getElementById('empty-state');
const btnMobileMenu = document.getElementById('btnMobileMenu');
const sidebar = document.getElementById('sidebar');
const overlay = document.getElementById('overlay');

const loginContainer = document.getElementById('login-container');
const appContainer = document.getElementById('app-container');
const loginForm = document.getElementById('login-form');
const licenseInput = document.getElementById('license-key');
const loginError = document.getElementById('login-error');
const welcomeMessage = document.getElementById('welcome-message');

const modalOverlay = document.getElementById('customModal');
const modalTitle = document.getElementById('modalTitle');
const modalMessage = document.getElementById('modalMessage');
const modalInputContainer = document.getElementById('modalInputContainer');
const modalInput = document.getElementById('modalInput');
const modalBtnCancel = document.getElementById('modalBtnCancel');
const modalBtnConfirm = document.getElementById('modalBtnConfirm');
const modalBtnClose = document.getElementById('modalBtnClose');

window.addEventListener('DOMContentLoaded', () => {
    ensureActiveSession();
    checkSession();
    initProfileLogic();
});

function isUserComplete(u) {
    return !!(u && u.prefix && u.usLicense && u.organization);
}

function checkSession() {
    currentUser = loadStoredUser();
    currentPrefix = loadStoredPrefix();
    ensureActiveSession();
    if (isUserComplete(currentUser)) {
        showApp();
    } else {
        showLogin();
    }
}

function showApp() {
    if (loginContainer) loginContainer.classList.add('hidden');
    if (appContainer) appContainer.classList.remove('hidden');
    if (welcomeMessage && currentUser) {
        const name = currentUser.usName || currentUser.name || 'Usuario';
        welcomeMessage.textContent = `Bienvenido, ${name}`;
    }
    updateSidebarProfile();
    const suffix = getStorageKeySuffix();
    const lastId = localStorage.getItem(`KAIZEN_LAST_CHAT_ID_${suffix}`);
    if (lastId && sessions.find(s => s.id === lastId)) {
        loadSession(lastId);
    } else {
        ensureActiveSession();
    }
    renderHistory();
}

function showLogin() {
    if (loginContainer) loginContainer.classList.remove('hidden');
    if (appContainer) appContainer.classList.add('hidden');
    if (sidebar && window.innerWidth < 768) sidebar.classList.remove('open');
}

function showModal(options) {
    const { title, message = '', type = 'confirm', inputValue = '', confirmText = 'Confirmar', cancelText = 'Cancelar', danger = false } = options;
    return new Promise(resolve => {
        modalResolver = resolve;
        if (modalTitle) modalTitle.textContent = title;
        if (modalMessage) modalMessage.textContent = message;
        const actions = document.querySelector('.modal-actions');
        if (actions) actions.style.display = 'grid';
        if (modalBtnConfirm) {
            modalBtnConfirm.textContent = confirmText;
            modalBtnConfirm.classList.remove('primary', 'danger');
            modalBtnConfirm.classList.add(danger ? 'danger' : 'primary');
        }
        if (modalBtnCancel) modalBtnCancel.textContent = cancelText;
        if (modalInputContainer) {
            if (type === 'prompt') {
                modalInputContainer.style.display = 'block';
                if (modalMessage) modalMessage.style.display = message ? 'block' : 'none';
                if (modalInput) modalInput.value = inputValue;
            } else {
                modalInputContainer.style.display = 'none';
                if (modalMessage) modalMessage.style.display = 'block';
            }
        }
        if (modalOverlay) {
            modalOverlay.classList.add('active');
            if (type === 'prompt' && modalInput) {
                setTimeout(() => modalInput.focus(), 100);
            } else if (modalBtnConfirm) {
                modalBtnConfirm.focus();
            }
        } else {
            const res = type === 'prompt' ? prompt(message, inputValue) : confirm(message);
            resolve(res);
        }
    });
}

function closeModal(result) {
    if (modalOverlay) modalOverlay.classList.remove('active');
    if (modalResolver) {
        modalResolver(result);
        modalResolver = null;
    }
}

if (modalBtnCancel) modalBtnCancel.onclick = () => closeModal(null);
if (modalBtnClose) modalBtnClose.onclick = () => closeModal(null);
if (modalBtnConfirm) modalBtnConfirm.onclick = () => {
    if (modalInputContainer && modalInputContainer.style.display === 'block') {
        closeModal(modalInput.value);
    } else {
        closeModal(true);
    }
};
if (modalInput) {
    modalInput.addEventListener('keydown', e => {
        if (e.key === 'Enter') modalBtnConfirm.click();
        if (e.key === 'Escape') closeModal(null);
    });
}
if (modalOverlay) {
    modalOverlay.addEventListener('mousedown', e => {
        if (e.target === modalOverlay) closeModal(null);
    });
}

if (loginForm) {
    loginForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const licenseKey = licenseInput.value.trim();
        if (!licenseKey) return;

        const btn = loginForm.querySelector('button');
        const originalText = btn.innerText;
        btn.innerText = 'Verificando...';
        btn.disabled = true;

        try {
            const response = await fetch(LOGIN_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ license: licenseKey })
            });

            const data = await response.json();

            if (response.ok && data.success && data.user) {
                const normalizedUser = {
                    usName: data.user.name || '',
                    prefix: data.user.prefix || '',
                    usLicense: data.user.license || '',
                    organization: data.user.organization || ''
                };

                currentUser = normalizedUser;
                currentPrefix = normalizedUser.prefix || null;

                localStorage.removeItem('ssoma_user');
                localStorage.removeItem('kaizen_user');

                localStorage.setItem('ssoma_user', JSON.stringify(normalizedUser));
                localStorage.setItem('kaizen_user', JSON.stringify(normalizedUser));
                localStorage.setItem('kaizen_mode', 'corporate');

                if (currentPrefix) {
                    localStorage.setItem('ssoma_prefix', currentPrefix);
                    localStorage.setItem('kaizen_prefix', currentPrefix);
                }

                if (data.token) {
                    localStorage.setItem('kaizen_token', data.token);
                }

                showApp();
            } else {
                if (loginError) {
                    loginError.textContent = data.message || data.error || 'Licencia inválida';
                    loginError.classList.remove('hidden');
                }
            }
        } catch (error) {
            if (loginError) {
                loginError.textContent = 'Error de conexión';
                loginError.classList.remove('hidden');
            }
        } finally {
            btn.innerText = originalText;
            btn.disabled = false;
        }
    });
}

function ensureActiveSession() {
    if (sessions.length === 0) {
        createNewSession();
    } else if (!activeSessionId) {
        loadSession(sessions[0].id);
    }
}

function createNewSession() {
    const id = Date.now().toString();
    const newSession = { id, title: 'Nuevo Chat', messages: [], timestamp: Date.now() };
    sessions.unshift(newSession);
    saveSessions();
    loadSession(id);
}

function loadSession(id) {
    activeSessionId = id;
    const suffix = getStorageKeySuffix();
    localStorage.setItem(`KAIZEN_LAST_CHAT_ID_${suffix}`, id);
    const session = sessions.find(s => s.id === id);
    if (!session) {
        createNewSession();
        return;
    }
    if (messagesDiv) {
        messagesDiv.innerHTML = '';
        if (emptyState) messagesDiv.appendChild(emptyState);
        if (session.messages.length === 0) {
            if (emptyState) emptyState.style.display = 'flex';
        } else {
            if (emptyState) emptyState.style.display = 'none';
            session.messages.forEach(msg => appendMessageUI(msg.role, msg.text, msg.files));
        }
    }
    renderHistory();
    if (sidebar) sidebar.classList.remove('open');
    if (overlay) overlay.classList.remove('active');
}

function saveSessions() {
    const suffix = getStorageKeySuffix();
    localStorage.setItem(`kaizen_sessions_${suffix}`, JSON.stringify(sessions));
}

async function deleteSession(e, id) {
    e.stopPropagation();
    const confirmed = await showModal({ title: '¿Eliminar conversación?', message: 'Se perderá el historial.', confirmText: 'Eliminar', danger: true });
    if (!confirmed) return;
    sessions = sessions.filter(s => s.id !== id);
    saveSessions();
    if (sessions.length === 0) {
        createNewSession();
    } else if (activeSessionId === id) {
        loadSession(sessions[0].id);
    } else {
        renderHistory();
    }
}

async function renameSession(e, id) {
    e.stopPropagation();
    const session = sessions.find(s => s.id === id);
    if (!session) return;
    const newTitle = await showModal({ title: 'Renombrar Chat', type: 'prompt', inputValue: session.title, confirmText: 'Guardar' });
    if (newTitle && newTitle.trim() !== '') {
        session.title = newTitle.trim();
        saveSessions();
        renderHistory();
    }
}

function renderHistory() {
    if (!convList) return;
    convList.innerHTML = '';
    sessions.forEach(s => {
        const div = document.createElement('div');
        div.className = `conv-item ${s.id === activeSessionId ? 'active' : ''}`;
        div.onclick = () => loadSession(s.id);
        div.innerHTML = `
            <div class="conv-title" title="${s.title}">${s.title}</div>
            <div class="conv-actions">
                <button class="action-btn edit"><i class="fa-solid fa-pen"></i></button>
                <button class="action-btn delete"><i class="fa-solid fa-trash"></i></button>
            </div>
        `;
        div.querySelector('.edit').onclick = e => renameSession(e, s.id);
        div.querySelector('.delete').onclick = e => deleteSession(e, s.id);
        convList.appendChild(div);
    });
}

if (btnNewChat) btnNewChat.onclick = createNewSession;
if (btnMobileMenu) btnMobileMenu.onclick = () => {
    if (sidebar) sidebar.classList.add('open');
    if (overlay) overlay.classList.add('active');
};
if (overlay) overlay.onclick = () => {
    if (sidebar) sidebar.classList.remove('open');
    overlay.classList.remove('active');
};

function processFileFromEvent(file) {
    if (currentFiles.length > 0) {
        showModal({ title: 'Límite de Archivos', message: 'Solo se permite adjuntar un archivo por mensaje.', type: 'alert', confirmText: 'Entendido' });
        return;
    }
    const reader = new FileReader();
    reader.onload = function (evt) {
        currentFiles = [{
            filename: file.name || 'clipboard_image.png',
            mimetype: file.type || 'image/png',
            blobOrFile: file,
            base64Url: evt.target.result
        }];
        updateAttachFloat();
    };
    reader.readAsDataURL(file);
}

async function sendMessage() {
    if (!input) return;
    const text = input.value.trim();
    if (!text && currentFiles.length === 0) return;
    currentUser = loadStoredUser();
    currentPrefix = loadStoredPrefix();
    const actualPrefix = currentPrefix;
    const token = localStorage.getItem('kaizen_token');
    const userIdToSend = currentUser?.usLicense || currentUser?.id || currentUser?.prefix || currentUser?.usName || currentUser?.name || 'guest';
    ensureActiveSession();
    let session = sessions.find(s => s.id === activeSessionId);
    if (!session) {
        appendMessageUI('model', 'No se pudo preparar la conversacion. Intenta de nuevo.');
        return;
    }
    if (emptyState) emptyState.style.display = 'none';
    if (session.messages.length === 0) {
        let autoTitle = text || 'Archivo adjunto';
        if (text.length > 30) autoTitle = text.substring(0, 30) + '...';
        session.title = autoTitle;
        renderHistory();
    }
    const filesForHistory = currentFiles.map(file => ({
        name: file.filename || file.name,
        type: file.mimetype || file.type,
        url: (file.mimetype || file.type || '').startsWith('image/') ? file.base64Url : null
    }));
    const userMsgObj = { role: 'user', text, files: filesForHistory };
    session.messages.push(userMsgObj);
    saveSessions();
    appendMessageUI('user', text, filesForHistory);
    const filesToSend = [...currentFiles];
    input.value = '';
    currentFiles = [];
    updateAttachFloat();
    const loadingId = 'loading-' + Date.now();
    appendLoadingUI(loadingId);
    let payload;
    const headers = {};
    if (token) headers['Authorization'] = `Bearer ${token}`;
    if (filesToSend.length > 0) {
        const formData = new FormData();
        filesToSend.forEach(file => {
            formData.append('files', file.blobOrFile, file.filename || file.name);
        });
        formData.append('message', userMsgObj.text);
        formData.append('threadId', activeSessionId);
        formData.append('query', userMsgObj.text);
        formData.append('databaseId', actualPrefix || '');
        formData.append('userId', userIdToSend);
        payload = formData;
    } else {
        headers['Content-Type'] = 'application/json';
        payload = JSON.stringify({
            query: userMsgObj.text,
            message: userMsgObj.text,
            threadId: activeSessionId,
            databaseId: actualPrefix || null,
            userId: userIdToSend
        });
    }
    try {
        const res = await fetch(API_URL, {
            method: 'POST',
            headers,
            body: payload
        });
        if (!res.ok) {
            const errorText = await res.text();
            throw new Error(`Error del servidor (${res.status}): ${errorText}`);
        }
        const data = await res.json();
        const replyText = data.response || data.reply;
        if (replyText) {
            const aiMsgObj = { role: 'model', text: replyText, files: [] };
            session.messages.push(aiMsgObj);
            saveSessions();
            appendMessageUI('model', replyText);
        } else if (res.status === 401 || res.status === 403) {
            showModal({
                title: 'Sesión Expirada',
                message: 'Tu acceso ha caducado. Por favor inicia sesión nuevamente.',
                type: 'alert',
                confirmText: 'Ir al Login'
            }).then(() => showLogin());
        } else {
            appendMessageUI('model', 'Error: ' + (data.error || 'No se pudo conectar.'));
        }
    } catch (error) {
        appendMessageUI('model', 'Error de conexión: ' + error.message);
    } finally {
        const loader = document.getElementById(loadingId);
        if (loader) loader.remove();
    }
}

function appendMessageUI(role, text, files = []) {
    const div = document.createElement('div');
    div.className = `msg ${role}`;
    let fileHTML = '';
    if (files && files.length > 0) {
        fileHTML = `<div class="msg-files">${files.map(f => {
            if (f.url && f.type && f.type.startsWith('image/')) {
                return `<img src="${f.url}" class="msg-img" alt="${f.name}">`;
            }
            return `<div class="file-chip"><i class="fa fa-file"></i> ${f.name}</div>`;
        }).join('')}</div>`;
    }
    let htmlContent = '';
    if (typeof marked !== 'undefined') {
        htmlContent = marked.parse(text || '');
    } else {
        htmlContent = text;
    }
    div.innerHTML = `
        <div class="avatar">${role === 'user' ? '<i class="fa fa-user"></i>' : '<img src="./assets/Kaizen B.png" width="24">'}</div>
        <div class="bubble">${fileHTML}<div class="content markdown-body">${htmlContent}</div></div>
    `;
    if (messagesDiv) {
        messagesDiv.appendChild(div);
        messagesDiv.scrollTop = messagesDiv.scrollHeight;
    }
}

function appendLoadingUI(id) {
    const div = document.createElement('div');
    div.id = id;
    div.className = 'msg model';
    div.innerHTML = `
        <div class="avatar"><img src="./assets/Kaizen B.png" width="24"></div>
        <div class="bubble"><div class="typing-indicator"><span></span><span></span><span></span></div></div>
    `;
    if (messagesDiv) {
        messagesDiv.appendChild(div);
        messagesDiv.scrollTop = messagesDiv.scrollHeight;
    }
}

if (fileInput) {
    fileInput.addEventListener('change', e => {
        if (e.target.files.length > 0) {
            processFileFromEvent(e.target.files[0]);
        }
        e.target.value = '';
    });
}

function updateAttachFloat() {
    if (!attachFloat || !afName || !afSize) return;
    if (currentFiles.length > 0) {
        attachFloat.style.display = 'flex';
        afName.textContent = currentFiles[0].filename;
        afSize.textContent = 'Adjunto';
    } else {
        attachFloat.style.display = 'none';
        if (fileInput) fileInput.value = '';
    }
}

if (afClose) {
    afClose.onclick = () => {
        currentFiles = [];
        updateAttachFloat();
    };
}

if (sendBtn) {
    sendBtn.onclick = e => {
        e.preventDefault();
        sendMessage();
    };
}

if (input) {
    input.addEventListener('keydown', e => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendMessage();
        }
    });
}

const dropZone = document.getElementById('messages');
if (dropZone) {
    dropZone.addEventListener('dragover', e => {
        e.preventDefault();
        e.stopPropagation();
        dropZone.classList.add('drag-over');
    });
    dropZone.addEventListener('dragleave', e => {
        e.preventDefault();
        e.stopPropagation();
        dropZone.classList.remove('drag-over');
    });
    dropZone.addEventListener('drop', e => {
        e.preventDefault();
        e.stopPropagation();
        dropZone.classList.remove('drag-over');
        if (e.dataTransfer.files.length > 0) processFileFromEvent(e.dataTransfer.files[0]);
    });
}

document.addEventListener('paste', e => {
    const active = document.activeElement;
    if (!active || (active.tagName !== 'INPUT' && active.tagName !== 'TEXTAREA')) return;
    const items = (e.clipboardData || e.originalEvent?.clipboardData)?.items || [];
    for (const item of items) {
        if (item.kind === 'file') {
            e.preventDefault();
            const blob = item.getAsFile();
            if (blob) processFileFromEvent(blob);
            break;
        }
    }
});

function renderProfileModal() {
    const content = document.getElementById('modalMessage');
    const overlayEl = document.getElementById('customModal');
    const titleEl = document.getElementById('modalTitle');
    const actions = document.querySelector('.modal-actions');
    const inputCont = document.getElementById('modalInputContainer');
    if (!content || !overlayEl || !titleEl || !inputCont) return;
    titleEl.innerText = 'Mi Perfil';
    inputCont.style.display = 'none';
    if (actions) actions.style.display = 'none';
    overlayEl.classList.add('active');
    const mode = localStorage.getItem('kaizen_mode');
    const isGuest = mode === 'guest';
    const name = currentUser?.usName || currentUser?.name || 'Invitado';
    const org = currentUser?.organization || currentUser?.prefix || (isGuest ? 'DEMO' : '---');
    const licenseKey = isGuest ? 'GUEST-ACCESS-DEMO' : (currentUser?.usLicense || currentUser?.license || 'KZN-XXXX-XXXX-XXXX');
    const status = 'active';
    const masked = maskLicense(licenseKey);
    const html = `
    <div class="profile-container animate-fade">
        <div class="profile-grid">
            <div class="profile-card">
                <div class="pc-label">Usuario</div>
                <div class="pc-value">${name}</div>
                <div class="pc-sub">Organización: <span style="color:#fff">${org}</span></div>
                <div style="margin-top: 15px;">
                   <div class="pc-label">Nivel de Acceso</div>
                   <div class="chips-wrap">
                      <span class="chip">${isGuest ? 'Básico' : 'Corporativo'} <span class="star">★</span></span>
                      ${!isGuest ? '<span class="chip">Gestión Documental</span>' : ''}
                   </div>
                </div>
            </div>
            <div class="profile-card">
                <div class="pc-label">Licencia</div>
                <div class="pc-value" style="font-family:monospace; font-size:0.95rem;">${masked}</div>
                <div style="margin-top: 15px;">
                    <div class="pc-label">Estado</div>
                    <div>${getStatusBadge(status)}</div>
                </div>
                <div style="margin-top: 15px;">
                    <div class="pc-label">Vigencia estimada</div>
                    <div class="pc-value" style="font-size:0.95rem; font-weight:400;">${isGuest ? 'Sesión Temporal' : 'Indefinida'}</div>
                </div>
            </div>
        </div>
        <div style="margin-top:20px; text-align:right;">
             <button class="modal-btn secondary" style="display:inline-flex; width:auto; padding: 8px 20px;" onclick="document.getElementById('customModal').classList.remove('active')">Cerrar</button>
        </div>
    </div>
    `;
    content.innerHTML = html;
}

function maskLicense(lic) {
    if (!lic) return '';
    const parts = String(lic).split('-');
    if (parts.length === 5) {
        return `${parts[0]}-****-****-****-${parts[4]}`;
    }
    return lic.length > 10 ? lic.substring(0, 4) + '-****-' + lic.substring(lic.length - 4) : lic;
}

function fmtDateES(d) {
    if (!d) return '';
    return new Intl.DateTimeFormat('es-CR', {
        year: 'numeric',
        month: 'long',
        day: '2-digit'
    }).format(d);
}

function getStatusBadge(status) {
    const map = {
        active: { label: 'activo', css: 'b-active' },
        expired: { label: 'expirada', css: 'b-expired' },
        revoked: { label: 'revocada', css: 'b-revoked' }
    };
    const s = map[status] || { label: 'desconocido', css: 'b-unknown' };
    return `
        <span class="badge ${s.css}">
            <span class="badge-dot"></span>
            <span style="text-transform: capitalize;">${s.label}</span>
        </span>
    `;
}

function updateSidebarProfile() {
    const sbName = document.getElementById('sidebarUserName');
    const sbLic = document.getElementById('sidebarUserLic');
    const mode = localStorage.getItem('kaizen_mode');
    if (!currentUser) return;
    if (sbName) sbName.textContent = currentUser.usName || currentUser.name || 'Usuario';
    if (sbLic) {
        if (mode === 'guest') {
            sbLic.textContent = 'Modo Invitado';
            sbLic.style.color = '#fbbf24';
        } else {
            const org = currentUser.organization || currentUser.prefix || '---';
            const prefix = currentPrefix || currentUser.prefix || 'UNK';
            sbLic.textContent = `${org} · ${prefix}`;
            sbLic.style.color = '#6b7280';
        }
    }
}

function initProfileLogic() {
    const userProfileBtn = document.getElementById('userProfileBtn');
    const userMenuPopover = document.getElementById('userMenuPopover');
    const menuBtnLogout = document.getElementById('menuBtnLogout');
    const menuBtnProfile = document.getElementById('menuBtnProfile');
    
    if (userProfileBtn && userMenuPopover) {
        userProfileBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            userMenuPopover.classList.toggle('active');
        });

        document.addEventListener('click', (e) => {
            if (!userProfileBtn.contains(e.target)) {
                userMenuPopover.classList.remove('active');
            }
        });
    }

    if (menuBtnLogout) {
        menuBtnLogout.addEventListener('click', () => {
            if (userMenuPopover) userMenuPopover.classList.remove('active');
            showModal({ 
                title: 'Cerrar Sesión', 
                message: '¿Estás seguro que deseas salir?', 
                confirmText: 'Sí, salir',
                cancelText: 'Cancelar',
                danger: true 
            }).then((confirmed) => {
                if (confirmed) {
                    localStorage.clear();
                    sessionStorage.clear();
                    window.location.href = 'login.html';
                }
            });
        });
    }

    if (menuBtnProfile) {
        menuBtnProfile.addEventListener('click', () => {
            if (userMenuPopover) userMenuPopover.classList.remove('active');
            renderProfileModal();
        });
    }
}