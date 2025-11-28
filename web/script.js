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

const modalOverlay = document.getElementById('customModal');
const modalTitle = document.getElementById('modalTitle');
const modalMessage = document.getElementById('modalMessage');
const modalInputContainer = document.getElementById('modalInputContainer');
const modalInput = document.getElementById('modalInput');
const modalBtnCancel = document.getElementById('modalBtnCancel');
const modalBtnConfirm = document.getElementById('modalBtnConfirm');
const modalBtnClose = document.getElementById('modalBtnClose');

const isLocal = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
const API_URL = isLocal ? 'http://127.0.0.1:3000/chat/query' : 'https://ssoma-kaizen-api.onrender.com/chat/query';

let currentFiles = [];
let sessions = JSON.parse(localStorage.getItem('kaizen_sessions')) || [];
let activeSessionId = null;
let modalResolver = null;

window.addEventListener('DOMContentLoaded', () => {
  if (sessions.length > 0) {
    const lastId = localStorage.getItem('KAIZEN_LAST_CHAT_ID');
    const targetId = sessions.find(s => s.id === lastId) ? lastId : sessions[0].id;
    loadSession(targetId);
  } else {
    createNewSession();
  }
  renderHistory();
});

function showModal({ title, message = '', type = 'confirm', inputValue = '', confirmText = 'Confirmar', danger = false }) {
  return new Promise((resolve) => {
    modalResolver = resolve;
    modalTitle.textContent = title;
    modalMessage.textContent = message;
    modalBtnConfirm.textContent = confirmText;

    if (type === 'prompt') {
      modalInputContainer.style.display = 'block';
      modalMessage.style.display = message ? 'block' : 'none';
      modalInput.value = inputValue;
    } else {
      modalInputContainer.style.display = 'none';
      modalMessage.style.display = 'block';
    }

    if (danger) {
      modalBtnConfirm.classList.remove('primary');
      modalBtnConfirm.classList.add('danger');
    } else {
      modalBtnConfirm.classList.remove('danger');
      modalBtnConfirm.classList.add('primary');
    }

    modalOverlay.classList.add('active');
    
    if (type === 'prompt') setTimeout(() => modalInput.focus(), 100);
    else modalBtnConfirm.focus();
  });
}

function closeModal(result) {
  modalOverlay.classList.remove('active');
  if (modalResolver) {
    modalResolver(result);
    modalResolver = null;
  }
}

modalBtnCancel.onclick = () => closeModal(null);
modalBtnClose.onclick = () => closeModal(null);
modalBtnConfirm.onclick = () => {
  if (modalInputContainer.style.display === 'block') closeModal(modalInput.value);
  else closeModal(true);
};
modalInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') modalBtnConfirm.click();
  if (e.key === 'Escape') closeModal(null);
});
modalOverlay.addEventListener('mousedown', (e) => {
  if (e.target === modalOverlay) closeModal(null);
});

function createNewSession() {
  const id = Date.now().toString();
  const newSession = {
    id,
    title: 'Nuevo Chat',
    messages: [],
    timestamp: Date.now()
  };
  sessions.unshift(newSession);
  saveSessions();
  loadSession(id);
}

function loadSession(id) {
  activeSessionId = id;
  localStorage.setItem('KAIZEN_LAST_CHAT_ID', id);
  const session = sessions.find(s => s.id === id);
  if (!session) return createNewSession();

  messagesDiv.innerHTML = '';
  messagesDiv.appendChild(emptyState);

  if (session.messages.length === 0) {
    emptyState.style.display = 'flex';
  } else {
    emptyState.style.display = 'none';
    session.messages.forEach(msg => appendMessageUI(msg.role, msg.text, msg.files));
  }

  renderHistory();
  sidebar.classList.remove('open');
  overlay.classList.remove('active');
}

function saveSessions() {
  localStorage.setItem('kaizen_sessions', JSON.stringify(sessions));
}

async function deleteSession(e, id) {
  e.stopPropagation();
  const confirmed = await showModal({
    title: '¿Eliminar conversación?',
    message: 'Se perderá todo el historial de este chat.',
    confirmText: 'Eliminar',
    danger: true
  });

  if (!confirmed) return;

  sessions = sessions.filter(s => s.id !== id);
  saveSessions();

  if (sessions.length === 0) createNewSession();
  else if (activeSessionId === id) loadSession(sessions[0].id);
  else renderHistory();
}

async function renameSession(e, id) {
  e.stopPropagation();
  const session = sessions.find(s => s.id === id);
  if (!session) return;

  const newTitle = await showModal({
    title: 'Renombrar Chat',
    type: 'prompt',
    inputValue: session.title,
    confirmText: 'Guardar'
  });

  if (newTitle && newTitle.trim() !== '') {
    session.title = newTitle.trim();
    saveSessions();
    renderHistory();
  }
}

function renderHistory() {
  convList.innerHTML = '';
  sessions.forEach(s => {
    const div = document.createElement('div');
    div.className = `conv-item ${s.id === activeSessionId ? 'active' : ''}`;
    div.onclick = () => loadSession(s.id);

    div.innerHTML = `
      <div class="conv-title" title="${s.title}">${s.title}</div>
      <div class="conv-actions">
        <button class="action-btn edit" title="Renombrar"><i class="fa-solid fa-pen"></i></button>
        <button class="action-btn delete" title="Eliminar"><i class="fa-solid fa-trash"></i></button>
      </div>
    `;

    div.querySelector('.edit').onclick = (e) => renameSession(e, s.id);
    div.querySelector('.delete').onclick = (e) => deleteSession(e, s.id);
    convList.appendChild(div);
  });
}

btnNewChat.onclick = createNewSession;
btnMobileMenu.onclick = () => {
    sidebar.classList.add('open');
    overlay.classList.add('active');
};
overlay.onclick = () => {
    sidebar.classList.remove('open');
    overlay.classList.remove('active');
};

async function sendMessage() {
  const text = input.value.trim();
  if (!text && currentFiles.length === 0) return;

  emptyState.style.display = 'none';
  const session = sessions.find(s => s.id === activeSessionId);
  
  if (session && session.messages.length === 0) {
    let autoTitle = text || "Archivo adjunto";
    if (text.length > 30) autoTitle = text.substring(0, 30) + '...';
    session.title = autoTitle;
    renderHistory();
  }

  const userMsgObj = { role: 'user', text: text, files: [...currentFiles] };
  session.messages.push(userMsgObj);
  saveSessions();
  appendMessageUI('user', text, currentFiles);

  input.value = '';
  currentFiles = [];
  updateAttachFloat();

  const loadingId = 'loading-' + Date.now();
  appendLoadingUI(loadingId);

  try {
    const payload = {
        text: userMsgObj.text,
        threadId: activeSessionId,
        files: userMsgObj.files 
    };

    const response = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const data = await response.json();
    document.getElementById(loadingId)?.remove();

    if (data.success) {
        const aiMsgObj = { role: 'model', text: data.reply, files: [] };
        session.messages.push(aiMsgObj);
        saveSessions();
        appendMessageUI('model', data.reply);
    } else {
        appendMessageUI('model', 'Error: ' + (data.error || 'No se pudo conectar.'));
    }

  } catch (error) {
    document.getElementById(loadingId)?.remove();
    appendMessageUI('model', 'Error de conexión. Verifica que el servidor esté corriendo.');
    console.error(error);
  }
}

function appendMessageUI(role, text, files = []) {
  const div = document.createElement('div');
  div.className = `msg ${role}`;
  
  let fileHTML = '';
  if (files && files.length > 0) {
    fileHTML = `<div class="msg-files">
      ${files.map(f => `<div class="file-chip"><i class="fa fa-file"></i> ${f.filename || 'Archivo'}</div>`).join('')}
    </div>`;
  }

  const htmlContent = marked.parse(text || '');
  div.innerHTML = `
    <div class="avatar">${role === 'user' ? '<i class="fa fa-user"></i>' : '<img src="./assets/Kaizen B.png" width="24">'}</div>
    <div class="bubble">
        ${fileHTML}
        <div class="content">${htmlContent}</div>
    </div>
  `;
  messagesDiv.appendChild(div);
  messagesDiv.scrollTop = messagesDiv.scrollHeight;
}

function appendLoadingUI(id) {
  const div = document.createElement('div');
  div.id = id;
  div.className = 'msg model';
  div.innerHTML = `
    <div class="avatar">
        <img src="./assets/Kaizen B.png" width="24" alt="AI">
    </div>
    <div class="bubble">
        <div class="typing-indicator">
            <span></span>
            <span></span>
            <span></span>
        </div>
    </div>
  `;
  messagesDiv.appendChild(div);
  messagesDiv.scrollTop = messagesDiv.scrollHeight;
}

fileInput.addEventListener('change', async (e) => {
  if (e.target.files.length > 0) {
    const file = e.target.files[0];
    const reader = new FileReader();
    reader.onload = function(evt) {
        currentFiles = [{
            filename: file.name,
            mimetype: file.type,
            base64: evt.target.result.split(',')[1]
        }];
        updateAttachFloat();
    };
    reader.readAsDataURL(file);
  }
});

function updateAttachFloat() {
  if (currentFiles.length > 0) {
    attachFloat.style.display = 'flex';
    afName.textContent = currentFiles[0].filename;
    afSize.textContent = 'Adjunto';
  } else {
    attachFloat.style.display = 'none';
    fileInput.value = '';
  }
}

afClose.onclick = () => { currentFiles = []; updateAttachFloat(); };
sendBtn.onclick = sendMessage;
input.addEventListener('keypress', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
});