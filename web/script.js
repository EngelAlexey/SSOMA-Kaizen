// --- CONFIGURACIÓN ---
// IMPORTANTE: Si estás en local, asegúrate que el backend corre en el puerto 3000.
// Si usas Render u otro host, cambia esta URL por la de producción.
const API_URL = 'http://localhost:3000/chat/query'; 
const LS_KEY = 'KAIZEN_SESSIONS_V4';

// --- ESTADO DE LA APLICACIÓN ---
const state = {
    chats: [],
    currentId: null,
    files: []
};

// --- DOM CACHE ---
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

// --- INICIO ---
const app = {
    init() {
        this.loadFromStorage();
        
        // Si no hay chats, crear uno nuevo
        if (state.chats.length === 0) {
            this.createNewChat();
        } else {
            // Cargar el último chat activo o el primero
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

        // Auto-resize textarea
        dom.input.addEventListener('input', function() {
            this.style.height = 'auto';
            this.style.height = (this.scrollHeight) + 'px';
            if(this.value === '') this.style.height = 'auto';
        });

        // Archivos
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

        // Navegación
        dom.btnNew.addEventListener('click', () => this.createNewChat());
        dom.btnMenu.addEventListener('click', () => this.toggleSidebar());
        dom.overlay.addEventListener('click', () => this.toggleSidebar(false));
    },

    // --- GESTIÓN DE DATOS ---
    loadFromStorage() {
        try {
            const stored = localStorage.getItem(LS_KEY);
            state.chats = stored ? JSON.parse(stored) : [];
        } catch (e) {
            console.error('Error cargando historial:', e);
            state.chats = [];
        }
    },

    saveToStorage() {
        localStorage.setItem(LS_KEY, JSON.stringify(state.chats));
        localStorage.setItem('KAIZEN_LAST_CHAT_ID', state.currentId);
        this.renderSidebar();
    },

    // --- LÓGICA DEL CHAT ---
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

        // Limpiar área de mensajes
        dom.messages.innerHTML = '';
        // Reinsertar empty state (oculto)
        dom.messages.appendChild(dom.emptyState);
        
        if (chat.messages.length === 0) {
            dom.emptyState.style.display = 'flex';
        } else {
            dom.emptyState.style.display = 'none';
            // Renderizar mensajes con un pequeño delay para evitar parpadeo brusco
            requestAnimationFrame(() => {
                chat.messages.forEach(msg => this.renderMessage(msg));
                this.scrollToBottom();
            });
        }

        this.renderSidebar();
        // Guardar ID actual
        localStorage.setItem('KAIZEN_LAST_CHAT_ID', id);
    },

    deleteChat(id, e) {
        e.stopPropagation();
        if (!confirm('¿Eliminar este chat del historial?')) return;
        
        state.chats = state.chats.filter(c => c.id !== id);
        
        if (state.chats.length === 0) {
            this.createNewChat();
        } else if (state.currentId === id) {
            this.loadChat(state.chats[0].id);
        }
        this.saveToStorage();
    },

    // --- ENVIAR MENSAJE ---
    async sendMessage() {
        const text = dom.input.value.trim();
        const files = [...state.files];

        if (!text && files.length === 0) return;

        // 1. UI Optimista
        dom.emptyState.style.display = 'none';
        this.renderMessage({ role: 'user', content: text, files: files });
        
        // Guardar en historial
        const fileMeta = files.map(f => ({ name: f.name, type: f.type }));
        this.pushMessageToState('user', text, fileMeta);

        // Limpiar
        dom.input.value = '';
        dom.input.style.height = 'auto';
        state.files = [];
        this.renderFilePreview();

        // Loader
        const loaderId = this.showLoader();
        dom.sendBtn.disabled = true;

        try {
            // 2. Preparar Datos
            const formData = new FormData();
            formData.append('text', text);
            files.forEach(f => formData.append('files', f));

            // 3. Llamada API
            const res = await fetch(API_URL, {
                method: 'POST',
                body: formData
            });

            if (!res.ok) {
                throw new Error(`Error del servidor (${res.status})`);
            }

            const data = await res.json();
            this.removeLoader(loaderId);

            if (data.success) {
                this.renderMessage({ role: 'ai', content: data.reply });
                this.pushMessageToState('ai', data.reply);
                
                // Renombrar chat si es el primer mensaje
                const current = state.chats.find(c => c.id === state.currentId);
                if (current && current.messages.length <= 2 && text) {
                    current.title = text.length > 30 ? text.substring(0, 30) + '...' : text;
                    this.saveToStorage();
                }
            } else {
                this.renderMessage({ role: 'system', content: `⚠️ ${data.message || 'Error desconocido'}` });
            }

        } catch (error) {
            this.removeLoader(loaderId);
            console.error(error);
            this.renderMessage({ 
                role: 'system', 
                content: `❌ <strong>Error de conexión:</strong> No se pudo contactar con la API en <code>${API_URL}</code>.<br>Verifica que el servidor esté corriendo con <code>npm start</code> en la carpeta <code>api</code>.` 
            });
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

    // --- RENDERIZADO UI ---
    renderMessage(msg) {
        const div = document.createElement('div');
        div.className = `msg ${msg.role}`;

        if (msg.role === 'system') {
            div.innerHTML = `<div style="width:100%; text-align:center; color:#ff6b6b; font-size:13px; background:rgba(255,0,0,0.1); padding:10px; border-radius:8px; border:1px solid rgba(255,0,0,0.2); max-width: 600px; margin: 0 auto 20px;">${msg.content}</div>`;
            dom.messages.appendChild(div);
            this.scrollToBottom();
            return;
        }

        const avatarSrc = msg.role === 'ai' ? './assets/Kaizen B.png' : './assets/Icon App.png';
        
        // Si es 'ai', no mostramos el nombre en la meta (redundante con el avatar), o muy sutil
        // Si es 'user', nombre "TÚ" pequeño y gris
        const label = msg.role === 'ai' ? 'KAIZEN AI' : 'TÚ';

        let filesHtml = '';
        if (msg.files && msg.files.length > 0) {
            filesHtml = '<div style="display:flex; gap:6px; flex-wrap:wrap; margin-bottom:8px;">';
            msg.files.forEach(f => {
                const fname = f.name || f;
                filesHtml += `<div class="file-chip"><i class="fa-solid fa-paperclip"></i> ${fname}</div>`;
            });
            filesHtml += '</div>';
        }

        // Renderizar Markdown solo para IA, texto plano para usuario (seguridad)
        const contentHtml = msg.role === 'ai' ? marked.parse(msg.content) : msg.content.replace(/\n/g, '<br>');

        div.innerHTML = `
            <div class="avatar ${msg.role}"><img src="${avatarSrc}"></div>
            <div style="width:100%; min-width:0;">
                <div class="meta">${label}</div>
                ${filesHtml}
                <div class="bubble ${msg.role === 'ai' ? 'markdown-body' : ''}">${contentHtml}</div>
            </div>
        `;

        dom.messages.appendChild(div);
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
                    ${chat.id === state.currentId ? `<i class="fa-solid fa-trash text-xs text-gray-500 hover:text-red-500 p-1 z-10" onclick="app.deleteChat('${chat.id}', event)"></i>` : ''}
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
            // Calcular tamaño total
            const totalSize = state.files.reduce((acc, f) => acc + f.size, 0);
            dom.afSize.textContent = (totalSize / 1024).toFixed(1) + ' KB';
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

// Inicializar
document.addEventListener('DOMContentLoaded', () => app.init());