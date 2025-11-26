// --- CONFIGURACIÓN ---
const isLocal = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';

// Usamos 127.0.0.1 en lugar de localhost para evitar conflictos de resolución IPv6
const API_URL = isLocal 
    ? 'http://127.0.0.1:3000/chat/query' 
    : 'https://ssoma-kaizen-api.onrender.com/chat/query'; 

const LS_KEY = 'KAIZEN_SESSIONS_V5';

const state = {
    chats: [],
    currentId: null,
    files: []
};

const dom = {
    input: document.getElementById('input'),
    sendBtn: document.getElementById('sendBtn'),
    messages: document.getElementById('messages'),
    convList: document.getElementById('convList'),
    fileInput: document.getElementById('fileInput'),
    attachFloat: document.getElementById('attachFloat'),
    afName: document.getElementById('afName'),
    afSize: document.getElementById('afSize'),
    afClose: document.getElementById('afClose'),
    emptyState: document.getElementById('empty-state'),
    sidebar: document.getElementById('sidebar'),
    overlay: document.getElementById('overlay'),
    btnNew: document.getElementById('btnNewChat'),
    btnMenu: document.getElementById('btnMobileMenu')
};

const app = {
    init() {
        this.loadFromStorage();
        if (state.chats.length === 0) {
            this.createNewChat();
        } else {
            const lastActiveId = localStorage.getItem('KAIZEN_LAST_CHAT_ID');
            const targetId = state.chats.find(c => c.id === lastActiveId) ? lastActiveId : state.chats[0].id;
            this.loadChat(targetId);
        }
        this.renderSidebar();
        this.bindEvents();
    },

    bindEvents() {
        dom.sendBtn.addEventListener('click', () => this.sendMessage());
        
        dom.input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                this.sendMessage();
            }
        });

        dom.input.addEventListener('input', function() {
            this.style.height = 'auto';
            this.style.height = (this.scrollHeight) + 'px';
            if(this.value === '') this.style.height = 'auto';
        });

        dom.fileInput.addEventListener('change', (e) => {
            if (e.target.files.length > 0) {
                state.files = Array.from(e.target.files);
                this.renderFilePreview();
            }
            e.target.value = '';
        });

        dom.afClose.addEventListener('click', () => {
            state.files = [];
            this.renderFilePreview();
        });

        dom.btnNew.addEventListener('click', () => this.createNewChat());
        dom.btnMenu.addEventListener('click', () => this.toggleSidebar());
        dom.overlay.addEventListener('click', () => this.toggleSidebar(false));
    },

    loadFromStorage() {
        try {
            const stored = localStorage.getItem(LS_KEY);
            state.chats = stored ? JSON.parse(stored) : [];
        } catch (e) {
            console.error('Error storage:', e);
            state.chats = [];
        }
    },

    saveToStorage() {
        localStorage.setItem(LS_KEY, JSON.stringify(state.chats));
        localStorage.setItem('KAIZEN_LAST_CHAT_ID', state.currentId);
        this.renderSidebar();
    },

    createNewChat() {
        const newChat = {
            id: Date.now().toString(),
            title: 'Nueva Consulta',
            messages: [],
            timestamp: Date.now()
        };
        state.chats.unshift(newChat);
        this.saveToStorage();
        this.loadChat(newChat.id);
        if (window.innerWidth < 980) this.toggleSidebar(false);
        dom.input.focus();
    },

    loadChat(id) {
        state.currentId = id;
        const chat = state.chats.find(c => c.id === id);
        if (!chat) return;

        dom.messages.innerHTML = '';
        dom.messages.appendChild(dom.emptyState);
        
        if (chat.messages.length === 0) {
            dom.emptyState.style.display = 'flex';
        } else {
            dom.emptyState.style.display = 'none';
            // Usamos fragmento para renderizado atómico (sin parpadeo)
            const fragment = document.createDocumentFragment();
            chat.messages.forEach(msg => {
                const el = this.createMessageElement(msg);
                fragment.appendChild(el);
            });
            dom.messages.appendChild(fragment);
            this.scrollToBottom();
        }
        this.renderSidebar();
        localStorage.setItem('KAIZEN_LAST_CHAT_ID', id);
    },

    deleteChat(id, e) {
        e.stopPropagation();
        if (!confirm('¿Eliminar chat?')) return;
        state.chats = state.chats.filter(c => c.id !== id);
        if (state.chats.length === 0) this.createNewChat();
        else if (state.currentId === id) this.loadChat(state.chats[0].id);
        this.saveToStorage();
    },

    async sendMessage() {
        const text = dom.input.value.trim();
        const files = [...state.files];

        if (!text && files.length === 0) return;

        dom.emptyState.style.display = 'none';
        this.appendMessageUI({ role: 'user', content: text, files: files });
        
        const fileMeta = files.map(f => ({ name: f.name, type: f.type }));
        this.pushMessageToState('user', text, fileMeta);

        dom.input.value = '';
        dom.input.style.height = 'auto';
        state.files = [];
        this.renderFilePreview();

        const loaderId = this.showLoader();
        dom.sendBtn.disabled = true;

        try {
            const formData = new FormData();
            formData.append('text', text);
            files.forEach(f => formData.append('files', f));

            console.log(`Enviando a: ${API_URL}`);
            const res = await fetch(API_URL, { method: 'POST', body: formData });

            if (!res.ok) throw new Error(`Error ${res.status}`);
            const data = await res.json();
            
            this.removeLoader(loaderId);

            if (data.success) {
                this.appendMessageUI({ role: 'ai', content: data.reply });
                this.pushMessageToState('ai', data.reply);
                
                const current = state.chats.find(c => c.id === state.currentId);
                if (current && current.messages.length <= 2 && text) {
                    current.title = text.length > 30 ? text.substring(0, 30) + '...' : text;
                    this.saveToStorage();
                }
            } else {
                this.appendMessageUI({ role: 'system', content: `⚠️ ${data.message}` });
            }

        } catch (error) {
            this.removeLoader(loaderId);
            this.appendMessageUI({ role: 'system', content: `❌ Error de conexión. Verifica que la API esté corriendo.` });
        } finally {
            dom.sendBtn.disabled = false;
            dom.input.focus();
        }
    },

    pushMessageToState(role, content, files = []) {
        const chat = state.chats.find(c => c.id === state.currentId);
        if (chat) {
            chat.messages.push({ role, content, files, timestamp: Date.now() });
            this.saveToStorage();
        }
    },

    createMessageElement(msg) {
        const div = document.createElement('div');
        div.className = `msg ${msg.role}`;

        if (msg.role === 'system') {
            div.innerHTML = `<div style="width:100%; text-align:center; color:#ff6b6b; font-size:12px; background:rgba(255,0,0,0.1); padding:8px; border-radius:6px; max-width: 80%; margin:0 auto;">${msg.content}</div>`;
            return div;
        }

        const avatarSrc = msg.role === 'ai' ? './assets/Kaizen B.png' : './assets/Icon App.png';
        const label = msg.role === 'ai' ? 'KAIZEN AI' : 'TÚ';

        let filesHtml = '';
        if (msg.files && msg.files.length > 0) {
            filesHtml = '<div style="display:flex; gap:6px; flex-wrap:wrap; margin-bottom:6px;">';
            msg.files.forEach(f => {
                const fname = f.name || f;
                filesHtml += `<div class="file-chip"><i class="fa-solid fa-paperclip"></i> ${fname}</div>`;
            });
            filesHtml += '</div>';
        }

        const contentHtml = msg.role === 'ai' ? marked.parse(msg.content) : msg.content.replace(/\n/g, '<br>');

        div.innerHTML = `
            <div class="avatar ${msg.role}"><img src="${avatarSrc}"></div>
            <div style="width:100%; min-width:0;">
                <div class="meta">${label}</div>
                ${filesHtml}
                <div class="bubble ${msg.role === 'ai' ? 'markdown-body' : ''}">${contentHtml}</div>
            </div>
        `;
        return div;
    },

    appendMessageUI(msg) {
        const el = this.createMessageElement(msg);
        dom.messages.appendChild(el);
        this.scrollToBottom();
    },

    renderSidebar() {
        dom.convList.innerHTML = '';
        state.chats.forEach(chat => {
            const el = document.createElement('div');
            el.className = `conv ${chat.id === state.currentId ? 'active' : ''}`;
            el.innerHTML = `
                <div class="t">${chat.title}</div>
                <div style="display:flex; justify-content:space-between; align-items:center; margin-top:2px;">
                    <span class="s">${new Date(chat.timestamp).toLocaleDateString()}</span>
                    ${chat.id === state.currentId ? `<i class="fa-solid fa-trash text-xs text-gray-500 hover:text-red-500 p-1" onclick="app.deleteChat('${chat.id}', event)"></i>` : ''}
                </div>
            `;
            el.onclick = () => this.loadChat(chat.id);
            dom.convList.appendChild(el);
        });
    },

    renderFilePreview() {
        if (state.files.length > 0) {
            dom.attachFloat.style.display = 'flex';
            dom.afName.textContent = `${state.files.length} archivo(s)`;
            dom.afSize.textContent = (state.files.reduce((a, f) => a + f.size, 0) / 1024).toFixed(1) + ' KB';
        } else {
            dom.attachFloat.style.display = 'none';
        }
    },

    showLoader() {
        const id = 'loader-' + Date.now();
        const div = document.createElement('div');
        div.id = id;
        div.className = 'msg ai';
        div.innerHTML = `
            <div class="avatar ai"><img src="./assets/Kaizen B.png"></div>
            <div><div class="bubble" style="padding:10px 16px"><div class="typing"><div class="dot"></div><div class="dot"></div><div class="dot"></div></div></div></div>
        `;
        dom.messages.appendChild(div);
        this.scrollToBottom();
        return id;
    },

    removeLoader(id) {
        const el = document.getElementById(id);
        if (el) el.remove();
    },

    scrollToBottom() {
        dom.messages.scrollTop = dom.messages.scrollHeight;
    },

    toggleSidebar(force) {
        const isOpen = dom.sidebar.classList.contains('open');
        const shouldOpen = force !== undefined ? force : !isOpen;
        if (shouldOpen) {
            dom.sidebar.classList.add('open');
            dom.overlay.classList.add('active');
        } else {
            dom.sidebar.classList.remove('open');
            dom.overlay.classList.remove('active');
        }
    }
};

document.addEventListener('DOMContentLoaded', () => app.init());