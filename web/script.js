const isLocal = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
const API_URL = isLocal ? 'http://127.0.0.1:3000/chat/query' : 'https://ssoma-kaizen-api.onrender.com/chat/query'; 
const LS_KEY = 'KAIZEN_SESSIONS_V6';

const state = { chats: [], currentId: null, files: [] };

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
        if (state.chats.length === 0) this.createNewChat();
        else {
            const lastId = localStorage.getItem('KAIZEN_LAST_CHAT_ID');
            this.loadChat(state.chats.find(c => c.id === lastId) ? lastId : state.chats[0].id);
        }
        this.renderSidebar();
        this.bindEvents();
        this.renderFilePreview(); 
    },

    bindEvents() {
        if(dom.sendBtn) dom.sendBtn.addEventListener('click', () => this.sendMessage());
        
        if(dom.input) {
            dom.input.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); this.sendMessage(); }
            });
            dom.input.addEventListener('input', function() {
                this.style.height = 'auto'; this.style.height = (this.scrollHeight) + 'px';
                if(this.value === '') this.style.height = 'auto';
            });
        }

        if(dom.fileInput) {
            dom.fileInput.addEventListener('change', (e) => {
                if (e.target.files.length > 0) {
                    state.files = [...state.files, ...Array.from(e.target.files)];
                    this.renderFilePreview();
                }
                e.target.value = '';
            });
        }
        
        if(dom.afClose) {
            dom.afClose.addEventListener('click', () => {
                state.files = [];
                this.renderFilePreview();
            });
        }
        
        if(dom.btnNew) dom.btnNew.addEventListener('click', () => this.createNewChat());
        if(dom.btnMenu) dom.btnMenu.addEventListener('click', () => this.toggleSidebar());
        if(dom.overlay) dom.overlay.addEventListener('click', () => this.toggleSidebar(false));
    },

    renderFilePreview() {
        if (!dom.attachFloat) return; 
        
        if (state.files.length > 0) {
            dom.attachFloat.style.display = 'flex';
            if(dom.afName) dom.afName.textContent = `${state.files.length} archivo(s)`;
            if(dom.afSize) {
                const totalSize = state.files.reduce((acc, f) => acc + f.size, 0);
                dom.afSize.textContent = (totalSize / 1024).toFixed(1) + ' KB';
            }
        } else {
            dom.attachFloat.style.display = 'none';
        }
    },

    removeFile(index) {
        state.files.splice(index, 1);
        this.renderFilePreview();
    },

    async sendMessage() {
        const text = dom.input.value.trim();
        const files = [...state.files];
        if (!text && files.length === 0) return;

        if(dom.emptyState) dom.emptyState.style.display = 'none';
        
        const filesForHistory = await Promise.all(files.map(async f => {
            if(f.type.startsWith('image/')) {
                return { name: f.name, type: f.type, url: await this.fileToBase64(f) };
            }
            return { name: f.name, type: f.type };
        }));

        this.appendMessageUI({ role: 'user', content: text, files: filesForHistory });
        this.pushMessageToState('user', text, filesForHistory);

        dom.input.value = ''; dom.input.style.height = 'auto';
        state.files = []; this.renderFilePreview();
        
        const loaderId = this.showLoader();
        dom.sendBtn.disabled = true;

        try {
            const formData = new FormData();
            formData.append('text', text);
            files.forEach(f => formData.append('files', f));

            const res = await fetch(API_URL, { method: 'POST', body: formData });
            const data = await res.json();
            this.removeLoader(loaderId);

            if (data.success) {
                this.appendMessageUI({ role: 'ai', content: data.reply });
                this.pushMessageToState('ai', data.reply);
            } else {
                this.appendMessageUI({ role: 'system', content: data.message || 'Error desconocido' });
            }
        } catch (error) {
            this.removeLoader(loaderId);
            this.appendMessageUI({ role: 'system', content: `No se pudo conectar con el servidor.` });
        } finally {
            dom.sendBtn.disabled = false; dom.input.focus();
        }
    },

    fileToBase64(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.readAsDataURL(file);
            reader.onload = () => resolve(reader.result);
            reader.onerror = error => reject(error);
        });
    },

    appendMessageUI(msg) {
        const div = document.createElement('div');
        div.className = `msg ${msg.role}`;

        if (msg.role === 'system') {
            div.innerHTML = `<div class="system-msg">${msg.content}</div>`;
            dom.messages.appendChild(div);
            this.scrollToBottom();
            return;
        }

        let filesHtml = '';
        if (msg.files && msg.files.length > 0) {
            filesHtml = '<div class="msg-files">';
            msg.files.forEach(f => {
                if (f.type && f.type.startsWith('image/') && f.url) {
                    filesHtml += `<img src="${f.url}" class="msg-img" alt="${f.name}">`;
                } else {
                    filesHtml += `<div class="file-chip"><i class="fa-solid fa-file"></i> ${f.name}</div>`;
                }
            });
            filesHtml += '</div>';
        }

        const contentHtml = msg.role === 'ai' ? marked.parse(msg.content) : msg.content.replace(/\n/g, '<br>');
        const avatar = msg.role === 'ai' ? './assets/Kaizen B.png' : './assets/Icon App.png';

        div.innerHTML = `
            <div class="avatar ${msg.role}"><img src="${avatar}"></div>
            <div class="msg-content">
                <div class="meta">${msg.role === 'ai' ? 'KAIZEN AI' : 'TÚ'}</div>
                ${filesHtml}
                <div class="bubble ${msg.role === 'ai' ? 'markdown-body' : ''}">${contentHtml}</div>
            </div>
        `;

        dom.messages.appendChild(div);
        this.scrollToBottom();
    },

    loadFromStorage() { try { state.chats = JSON.parse(localStorage.getItem(LS_KEY)) || []; } catch(e){ state.chats=[]; } },
    saveToStorage() { localStorage.setItem(LS_KEY, JSON.stringify(state.chats)); localStorage.setItem('KAIZEN_LAST_CHAT_ID', state.currentId); this.renderSidebar(); },
    createNewChat() {
        const newChat = { id: Date.now().toString(), title: 'Nueva Consulta', messages: [], timestamp: Date.now() };
        state.chats.unshift(newChat); this.saveToStorage(); this.loadChat(newChat.id);
    },
    loadChat(id) {
        state.currentId = id; const chat = state.chats.find(c => c.id === id); if (!chat) return;
        dom.messages.innerHTML = ''; 
        if(dom.emptyState) dom.messages.appendChild(dom.emptyState);
        
        if (chat.messages.length === 0) {
            if(dom.emptyState) dom.emptyState.style.display = 'flex';
        } else {
            if(dom.emptyState) dom.emptyState.style.display = 'none';
            chat.messages.forEach(msg => this.appendMessageUI(msg));
        }
        this.renderSidebar(); localStorage.setItem('KAIZEN_LAST_CHAT_ID', id);
    },
    deleteChat(id, e) {
        e.stopPropagation(); if(!confirm('¿Borrar chat?')) return;
        state.chats = state.chats.filter(c => c.id !== id);
        if(state.chats.length===0) this.createNewChat(); else if(state.currentId===id) this.loadChat(state.chats[0].id);
        this.saveToStorage();
    },
    pushMessageToState(role, content, files) {
        const chat = state.chats.find(c => c.id === state.currentId);
        if(chat) { chat.messages.push({ role, content, files, timestamp: Date.now() }); this.saveToStorage(); }
    },
    renderSidebar() {
        if(!dom.convList) return;
        dom.convList.innerHTML = '';
        state.chats.forEach(chat => {
            const el = document.createElement('div');
            el.className = `conv ${chat.id === state.currentId ? 'active' : ''}`;
            el.innerHTML = `<div class="t">${chat.title}</div><div class="s">${new Date(chat.timestamp).toLocaleDateString()}</div>`;
            el.onclick = () => this.loadChat(chat.id);
            dom.convList.appendChild(el);
        });
    },
    showLoader() {
        const id = 'ldr'+Date.now();
        dom.messages.insertAdjacentHTML('beforeend', `<div id="${id}" class="msg ai"><div class="avatar ai"><img src="./assets/Kaizen B.png"></div><div class="bubble typing"><div class="dot"></div><div class="dot"></div><div class="dot"></div></div></div>`);
        this.scrollToBottom(); return id;
    },
    removeLoader(id) { const el = document.getElementById(id); if(el) el.remove(); },
    scrollToBottom() { dom.messages.scrollTop = dom.messages.scrollHeight; },
    toggleSidebar(force) { 
        if(dom.sidebar) dom.sidebar.classList.toggle('open', force); 
        if(dom.overlay) dom.overlay.classList.toggle('active', force); 
    }
};

window.app = app;
document.addEventListener('DOMContentLoaded', () => app.init());