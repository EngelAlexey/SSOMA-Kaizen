const API_URL = 'http://localhost:3000'; 

function showToast(title, message, type = 'info') {
    const container = document.getElementById('toast-container');
    
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    
    let iconClass = 'fa-info-circle';
    if (type === 'success') iconClass = 'fa-check-circle';
    if (type === 'error') iconClass = 'fa-exclamation-triangle';

    toast.innerHTML = `
        <i class="fas ${iconClass}"></i>
        <div class="toast-content">
            <span class="toast-title">${title}</span>
            <span class="toast-msg">${message}</span>
        </div>
    `;

    container.appendChild(toast);

    requestAnimationFrame(() => {
        toast.classList.add('visible');
    });

    setTimeout(() => {
        toast.classList.remove('visible');
        setTimeout(() => toast.remove(), 400);
    }, 4000);
}

function smoothRedirect(url) {
    document.body.classList.add('page-exit');
    setTimeout(() => {
        window.location.href = url;
    }, 800); 
}

const signUpButton = document.getElementById('signUp');
const signInButton = document.getElementById('signIn');
const container = document.getElementById('container');

signUpButton.addEventListener('click', () => container.classList.add("right-panel-active"));
signInButton.addEventListener('click', () => container.classList.remove("right-panel-active"));

document.getElementById('license-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const licenseInput = document.getElementById('license-input');
    const btn = e.target.querySelector('button');
    const licenseVal = licenseInput.value.trim();
    const originalBtnText = btn.innerText;

    if (!licenseVal) {
        showToast('Campo Vacío', 'Por favor ingresa tu licencia.', 'error');
        licenseInput.focus();
        return;
    }

    btn.innerText = "Verificando...";
    btn.style.opacity = "0.7";
    btn.disabled = true;

    try {
        const response = await fetch(`${API_URL}/auth/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ license: licenseVal })
        });

        const data = await response.json();

        if (data.success) {
            showToast('Acceso Autorizado', `Bienvenido, ${data.user.name}`, 'success');
            
            localStorage.setItem('kaizen_token', data.token);
            localStorage.setItem('kaizen_user', data.user.name);
            localStorage.setItem('kaizen_prefix', data.user.prefix);
            localStorage.setItem('kaizen_mode', 'corporate');

            setTimeout(() => {
                smoothRedirect('index.html');
            }, 1000);

        } else {
            throw new Error(data.error || "Licencia no válida.");
        }

    } catch (error) {
        console.error(error);
        const msg = error.message === 'Failed to fetch' ? 'No se pudo conectar al servidor.' : error.message;
        
        showToast('Acceso Denegado', msg, 'error');
        
        licenseInput.classList.add('input-error');
        setTimeout(() => licenseInput.classList.remove('input-error'), 500);
        
        btn.innerText = originalBtnText;
        btn.style.opacity = "1";
        btn.disabled = false;
    }
});

document.getElementById('btn-guest-access').addEventListener('click', (e) => {
    e.preventDefault();
    
    showToast('Modo Invitado', 'Iniciando entorno limitado...', 'info');
    
    localStorage.removeItem('kaizen_token');
    localStorage.setItem('kaizen_mode', 'guest');

    setTimeout(() => {
        smoothRedirect('index.html');
    }, 1200);
});