// --- CONFIGURACIÓN ---
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
    previewArea: document.getElementById('file-preview-area'), // Nuevo contenedor
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
    },

    bindEvents() {
        dom.sendBtn.addEventListener('click', () => this.sendMessage());
        dom.input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); this.sendMessage(); }
        });
        dom.input.addEventListener('input', function() {
            this.style.height = 'auto'; this.style.height = (this.scrollHeight) + 'px';
            if(this.value === '') this.style.height = 'auto';
        });
        dom.fileInput.addEventListener('change', (e) => {
            if (e.target.files.length > 0) {
                state.files = [...state.files, ...Array.from(e.target.files)];
                this.renderFilePreview();
            }
            e.target.value = '';
        });
        dom.btnNew.addEventListener('click', () => this.createNewChat());
        dom.btnMenu.addEventListener('click', () => this.toggleSidebar());
        dom.overlay.addEventListener('click', () => this.toggleSidebar(false));
    },

    // --- PREVIEW DE ARCHIVOS (MEJORADO) ---
    renderFilePreview() {
        dom.previewArea.innerHTML = '';
        if (state.files.length > 0) {
            dom.previewArea.classList.remove('hidden');
            state.files.forEach((file, index) => {
                const div = document.createElement('div');
                div.className = 'file-preview-card'; // Clase definida en CSS
                
                // Si es imagen, mostrar miniatura
                if (file.type.startsWith('image/')) {
                    const reader = new FileReader();
                    reader.onload = (e) => {
                        div.style.backgroundImage = `url(${e.target.result})`;
                        div.classList.add('is-image');
                    };
                    reader.readAsDataURL(file);
                } 
                
                div.innerHTML = `
                    <div class="file-info">
                        <span class="file-name">${file.name}</span>
                    </div>
                    <button onclick="app.removeFile(${index})" class="file-remove">×</button>
                `;
                dom.previewArea.appendChild(div);
            });
        } else {
            dom.previewArea.classList.add('hidden');
        }
    },

    removeFile(index) {
        state.files.splice(index, 1);
        this.renderFilePreview();
    },

    // --- MENSAJERÍA ---
    async sendMessage() {
        const text = dom.input.value.trim();
        const files = [...state.files];
        if (!text && files.length === 0) return;

        dom.emptyState.style.display = 'none';
        
        // Convertir archivos a Base64 para guardarlos en historial local (Solo imágenes pequeñas)
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

    // ... (Resto de funciones de Gestión de Datos y Sidebar iguales) ...
    
    // Gestión Storage, Chats y Sidebar (resumido por brevedad, es igual al anterior)
    loadFromStorage() { try { state.chats = JSON.parse(localStorage.getItem(LS_KEY)) || []; } catch(e){ state.chats=[]; } },
    saveToStorage() { localStorage.setItem(LS_KEY, JSON.stringify(state.chats)); localStorage.setItem('KAIZEN_LAST_CHAT_ID', state.currentId); this.renderSidebar(); },
    createNewChat() {
        const newChat = { id: Date.now().toString(), title: 'Nueva Consulta', messages: [], timestamp: Date.now() };
        state.chats.unshift(newChat); this.saveToStorage(); this.loadChat(newChat.id);
    },
    loadChat(id) {
        state.currentId = id; const chat = state.chats.find(c => c.id === id); if (!chat) return;
        dom.messages.innerHTML = ''; dom.messages.appendChild(dom.emptyState);
        dom.emptyState.style.display = chat.messages.length === 0 ? 'flex' : 'none';
        chat.messages.forEach(msg => this.appendMessageUI(msg));
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
    toggleSidebar(force) { dom.sidebar.classList.toggle('open', force); dom.overlay.classList.toggle('active', force); }
};

// Exponer funciones globales
window.app = app;
document.addEventListener('DOMContentLoaded', () => app.init());