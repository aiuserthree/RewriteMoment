/**
 * Rewrite Moment - Common JavaScript
 * ===================================
 */

// ==========================================
// Constants & Configuration
// ==========================================
const CONFIG = {
  animationDelay: 100,
  toastDuration: 3000,
  apiBaseUrl: '/api',
  storageKeys: {
    credits: 'rewrite_moment_credits',
    deviceId: 'rewrite_moment_device_id',
    uploadedFiles: 'rewrite_moment_uploaded',
    selections: 'rewrite_moment_selections',
  }
};

// ==========================================
// Utility Functions
// ==========================================
const Utils = {
  // Generate unique ID
  generateId() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = Math.random() * 16 | 0;
      const v = c === 'x' ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    });
  },

  // Format number with commas
  formatNumber(num) {
    return num.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  },

  // Format currency (KRW)
  formatCurrency(amount) {
    return `₩${this.formatNumber(amount)}`;
  },

  // Debounce function
  debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
      const later = () => {
        clearTimeout(timeout);
        func(...args);
      };
      clearTimeout(timeout);
      timeout = setTimeout(later, wait);
    };
  },

  // Throttle function
  throttle(func, limit) {
    let inThrottle;
    return function executedFunction(...args) {
      if (!inThrottle) {
        func(...args);
        inThrottle = true;
        setTimeout(() => inThrottle = false, limit);
      }
    };
  },

  // Local storage helpers
  storage: {
    get(key) {
      try {
        const item = localStorage.getItem(key);
        return item ? JSON.parse(item) : null;
      } catch (e) {
        return localStorage.getItem(key);
      }
    },
    set(key, value) {
      try {
        localStorage.setItem(key, typeof value === 'string' ? value : JSON.stringify(value));
      } catch (e) {
        console.error('Storage error:', e);
      }
    },
    remove(key) {
      localStorage.removeItem(key);
    }
  },

  // Session storage helpers
  session: {
    get(key) {
      try {
        const item = sessionStorage.getItem(key);
        return item ? JSON.parse(item) : null;
      } catch (e) {
        return sessionStorage.getItem(key);
      }
    },
    set(key, value) {
      try {
        sessionStorage.setItem(key, typeof value === 'string' ? value : JSON.stringify(value));
      } catch (e) {
        console.error('Session storage error:', e);
      }
    },
    remove(key) {
      sessionStorage.removeItem(key);
    }
  }
};

// ==========================================
// Device ID Management
// ==========================================
const DeviceManager = {
  getDeviceId() {
    let deviceId = Utils.storage.get(CONFIG.storageKeys.deviceId);
    if (!deviceId) {
      deviceId = Utils.generateId();
      Utils.storage.set(CONFIG.storageKeys.deviceId, deviceId);
    }
    return deviceId;
  }
};

// ==========================================
// Credit Management
// ==========================================
const CreditManager = {
  getBalance() {
    return parseInt(Utils.storage.get(CONFIG.storageKeys.credits)) || 0;
  },

  setBalance(amount) {
    Utils.storage.set(CONFIG.storageKeys.credits, amount);
    this.updateDisplay();
    return amount;
  },

  addCredits(amount) {
    const current = this.getBalance();
    return this.setBalance(current + amount);
  },

  deductCredits(amount) {
    const current = this.getBalance();
    if (current < amount) {
      throw new Error('Not enough credits');
    }
    return this.setBalance(current - amount);
  },

  hasEnough(amount) {
    return this.getBalance() >= amount;
  },

  updateDisplay() {
    const displays = document.querySelectorAll('.nav-credits-value, #currentCredits, #creditBalance');
    const balance = this.getBalance();
    displays.forEach(el => {
      if (el) el.textContent = balance;
    });
  }
};

// ==========================================
// Toast Notifications
// ==========================================
const Toast = {
  container: null,

  init() {
    // Check if toast container exists
    this.container = document.getElementById('toast');
    if (!this.container) {
      // Create toast container
      this.container = document.createElement('div');
      this.container.id = 'toast';
      this.container.className = 'toast';
      this.container.innerHTML = `
        <span class="toast-icon">✓</span>
        <span id="toastMessage"></span>
      `;
      document.body.appendChild(this.container);
    }
  },

  show(message, type = 'success') {
    if (!this.container) this.init();
    
    const messageEl = this.container.querySelector('#toastMessage') || this.container.querySelector('span:last-child');
    if (messageEl) messageEl.textContent = message;
    
    this.container.className = `toast toast-${type}`;
    this.container.classList.add('show');

    setTimeout(() => {
      this.container.classList.remove('show');
    }, CONFIG.toastDuration);
  },

  success(message) {
    this.show(message, 'success');
  },

  error(message) {
    this.show(message, 'error');
  },

  info(message) {
    this.show(message, 'info');
  }
};

// ==========================================
// Modal Management
// ==========================================
const Modal = {
  open(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) {
      modal.classList.add('show');
      document.body.style.overflow = 'hidden';
    }
  },

  close(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) {
      modal.classList.remove('show');
      document.body.style.overflow = '';
    }
  },

  initCloseHandlers() {
    // Close on overlay click
    document.querySelectorAll('.modal-overlay').forEach(overlay => {
      overlay.addEventListener('click', (e) => {
        if (e.target === overlay) {
          overlay.classList.remove('show');
          document.body.style.overflow = '';
        }
      });
    });

    // Close on escape key
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        document.querySelectorAll('.modal-overlay.show').forEach(modal => {
          modal.classList.remove('show');
        });
        document.body.style.overflow = '';
      }
    });
  }
};

// ==========================================
// Scroll Animations
// ==========================================
const ScrollAnimations = {
  init() {
    const elements = document.querySelectorAll('[data-animate]');
    
    if (!elements.length) return;

    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry, index) => {
        if (entry.isIntersecting) {
          // Add staggered delay based on element's position
          const delay = entry.target.style.animationDelay || `${index * 0.1}s`;
          entry.target.style.transitionDelay = delay;
          entry.target.classList.add('visible');
          observer.unobserve(entry.target);
        }
      });
    }, {
      threshold: 0.1,
      rootMargin: '0px 0px -50px 0px'
    });

    elements.forEach(el => observer.observe(el));
  }
};

// ==========================================
// Smooth Scroll
// ==========================================
const SmoothScroll = {
  init() {
    document.querySelectorAll('a[href^="#"]').forEach(anchor => {
      anchor.addEventListener('click', (e) => {
        const targetId = anchor.getAttribute('href');
        if (targetId === '#') return;
        
        const target = document.querySelector(targetId);
        if (target) {
          e.preventDefault();
          const offset = 100; // Account for fixed nav
          const targetPosition = target.getBoundingClientRect().top + window.scrollY - offset;
          
          window.scrollTo({
            top: targetPosition,
            behavior: 'smooth'
          });
        }
      });
    });
  }
};

// ==========================================
// Form Validation
// ==========================================
const FormValidation = {
  validate(form) {
    const inputs = form.querySelectorAll('[required]');
    let isValid = true;

    inputs.forEach(input => {
      if (!input.value.trim()) {
        this.showError(input, '필수 항목입니다');
        isValid = false;
      } else {
        this.clearError(input);
      }
    });

    return isValid;
  },

  showError(input, message) {
    input.classList.add('error');
    
    let errorEl = input.parentElement.querySelector('.form-error');
    if (!errorEl) {
      errorEl = document.createElement('span');
      errorEl.className = 'form-error';
      input.parentElement.appendChild(errorEl);
    }
    errorEl.textContent = message;
  },

  clearError(input) {
    input.classList.remove('error');
    const errorEl = input.parentElement.querySelector('.form-error');
    if (errorEl) errorEl.remove();
  }
};

// ==========================================
// File Upload Helpers
// ==========================================
const FileUpload = {
  validateFile(file, options = {}) {
    const {
      maxSize = 10 * 1024 * 1024, // 10MB
      allowedTypes = ['image/jpeg', 'image/png', 'image/webp']
    } = options;

    if (!allowedTypes.includes(file.type)) {
      return { valid: false, error: '지원하지 않는 파일 형식입니다' };
    }

    if (file.size > maxSize) {
      return { valid: false, error: `파일 크기는 ${maxSize / 1024 / 1024}MB 이하여야 합니다` };
    }

    return { valid: true };
  },

  readAsDataURL(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => resolve(e.target.result);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }
};

// ==========================================
// API Client (Placeholder)
// ==========================================
const API = {
  async request(endpoint, options = {}) {
    const url = `${CONFIG.apiBaseUrl}${endpoint}`;
    const defaultOptions = {
      headers: {
        'Content-Type': 'application/json',
      },
    };

    const response = await fetch(url, { ...defaultOptions, ...options });
    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || `Request failed: ${response.status}`);
    }

    return data;
  },

  get(endpoint) {
    return this.request(endpoint, { method: 'GET' });
  },

  post(endpoint, body) {
    return this.request(endpoint, {
      method: 'POST',
      body: JSON.stringify(body),
    });
  }
};

// ==========================================
// Navigation Active State
// ==========================================
const Navigation = {
  init() {
    const currentPath = window.location.pathname;
    const navLinks = document.querySelectorAll('.nav-link');

    navLinks.forEach(link => {
      const href = link.getAttribute('href');
      if (href && currentPath.includes(href.replace('.html', ''))) {
        link.style.color = 'var(--accent-primary)';
      }
    });
  }
};

// ==========================================
// Pricing Calculations
// ==========================================
const Pricing = {
  costs: {
    quick: 0,
    story: 2,
    trailer: 5,
    rewrite: 1,
    regen_clip: 1,
    regen_scene: 1
  },

  calculate(mode, options = {}) {
    let total = this.costs[mode] || 0;
    
    if (options.rewrite) {
      total += this.costs.rewrite;
    }

    return total;
  },

  getCost(type) {
    return this.costs[type] || 0;
  }
};

// ==========================================
// App Initialization
// ==========================================
const App = {
  init() {
    // Initialize all modules
    Toast.init();
    Modal.initCloseHandlers();
    ScrollAnimations.init();
    SmoothScroll.init();
    Navigation.init();
    CreditManager.updateDisplay();
    Auth.init();

    // Initialize device ID
    DeviceManager.getDeviceId();

    console.log('Rewrite Moment App initialized');
  }
};

// ==========================================
// DOM Ready
// ==========================================
document.addEventListener('DOMContentLoaded', () => {
  App.init();
});

// ==========================================
// Auth Management
// ==========================================
const Auth = {
  storageKey: 'rewrite_moment_user',

  getCurrentUser() {
    return Utils.storage.get(this.storageKey);
  },

  setUser(user) {
    Utils.storage.set(this.storageKey, user);
    this.updateUI();
  },

  clearUser() {
    Utils.storage.remove(this.storageKey);
    this.updateUI();
  },

  isLoggedIn() {
    return !!this.getCurrentUser();
  },

  updateUI() {
    const user = this.getCurrentUser();
    const loginBtn = document.getElementById('btn-open-login');
    const userMenu = document.getElementById('user-menu');
    const userAvatar = document.getElementById('user-avatar');
    const userName = document.getElementById('user-name');
    const userEmail = document.getElementById('user-email');

    if (user) {
      // Show user menu, hide login button
      if (loginBtn) loginBtn.classList.add('hidden');
      if (userMenu) userMenu.classList.remove('hidden');
      
      // Update user info
      if (userAvatar) userAvatar.textContent = user.name ? user.name.charAt(0).toUpperCase() : 'U';
      if (userName) userName.textContent = user.name || '사용자';
      if (userEmail) userEmail.textContent = user.email || '';

      // Update credits
      if (user.credits !== undefined) {
        CreditManager.setBalance(user.credits);
      }
    } else {
      // Show login button, hide user menu
      if (loginBtn) loginBtn.classList.remove('hidden');
      if (userMenu) userMenu.classList.add('hidden');
    }
  },

  init() {
    this.updateUI();
  }
};

// ==========================================
// Auth Modal Functions (Global)
// ==========================================

// Create auth modal HTML dynamically
function createAuthModal() {
  if (document.getElementById('auth-modal')) return;
  
  const modalHTML = `
  <div class="modal-overlay" id="auth-modal">
    <div class="modal auth-modal">
      <button class="modal-close" onclick="closeAuthModal()">×</button>
      
      <div id="login-form">
        <div class="auth-modal-header">
          <div class="auth-modal-logo">🎬</div>
          <h2 class="auth-modal-title">다시 만나서 반가워요!</h2>
          <p class="auth-modal-subtitle">로그인하고 나만의 영화를 만들어보세요</p>
        </div>

        <div class="social-login-buttons">
          <button class="btn-social btn-kakao" onclick="socialLogin('kakao')">
            <svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 3C6.48 3 2 6.48 2 10.8c0 2.76 1.84 5.18 4.6 6.54-.2.72-.72 2.6-.82 3-.14.54.2.53.42.38.18-.12 2.82-1.92 3.96-2.7.6.08 1.22.12 1.84.12 5.52 0 10-3.48 10-7.8S17.52 3 12 3z"/></svg>
            카카오로 시작하기
          </button>
          <button class="btn-social btn-naver" onclick="socialLogin('naver')">
            <svg viewBox="0 0 24 24" fill="currentColor"><path d="M16.273 12.845L7.376 0H0v24h7.727V11.155L16.624 24H24V0h-7.727z"/></svg>
            네이버로 시작하기
          </button>
          <button class="btn-social btn-google" onclick="socialLogin('google')">
            <svg viewBox="0 0 24 24"><path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/><path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/><path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/><path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/></svg>
            Google로 시작하기
          </button>
        </div>

        <div class="auth-divider">또는</div>

        <form class="auth-form" onsubmit="emailLogin(event)">
          <div class="form-group">
            <input type="email" class="form-input" placeholder="이메일" required id="login-email">
          </div>
          <div class="form-group">
            <div class="password-wrapper">
              <input type="password" class="form-input" placeholder="비밀번호" required id="login-password">
              <button type="button" class="password-toggle" onclick="togglePassword('login-password')">👁</button>
            </div>
          </div>
          <button type="submit" class="btn btn-primary">로그인</button>
        </form>

        <div class="auth-footer">
          계정이 없으신가요? <a href="#" onclick="switchAuthForm('signup'); return false;">회원가입</a>
        </div>
        <div class="auth-links">
          <a href="#">비밀번호 찾기</a>
        </div>
      </div>

      <div id="signup-form" class="hidden">
        <div class="auth-modal-header">
          <div class="auth-modal-logo">🎬</div>
          <h2 class="auth-modal-title">환영합니다!</h2>
          <p class="auth-modal-subtitle">간편하게 가입하고 영상을 만들어보세요</p>
        </div>

        <div class="social-login-buttons">
          <button class="btn-social btn-kakao" onclick="socialLogin('kakao')">
            <svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 3C6.48 3 2 6.48 2 10.8c0 2.76 1.84 5.18 4.6 6.54-.2.72-.72 2.6-.82 3-.14.54.2.53.42.38.18-.12 2.82-1.92 3.96-2.7.6.08 1.22.12 1.84.12 5.52 0 10-3.48 10-7.8S17.52 3 12 3z"/></svg>
            카카오로 시작하기
          </button>
          <button class="btn-social btn-naver" onclick="socialLogin('naver')">
            <svg viewBox="0 0 24 24" fill="currentColor"><path d="M16.273 12.845L7.376 0H0v24h7.727V11.155L16.624 24H24V0h-7.727z"/></svg>
            네이버로 시작하기
          </button>
          <button class="btn-social btn-google" onclick="socialLogin('google')">
            <svg viewBox="0 0 24 24"><path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/><path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/><path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/><path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/></svg>
            Google로 시작하기
          </button>
        </div>

        <div class="auth-divider">또는</div>

        <form class="auth-form" onsubmit="emailSignup(event)">
          <div class="form-group">
            <input type="text" class="form-input" placeholder="이름" required id="signup-name">
          </div>
          <div class="form-group">
            <input type="email" class="form-input" placeholder="이메일" required id="signup-email">
          </div>
          <div class="form-group">
            <div class="password-wrapper">
              <input type="password" class="form-input" placeholder="비밀번호 (8자 이상)" required minlength="8" id="signup-password">
              <button type="button" class="password-toggle" onclick="togglePassword('signup-password')">👁</button>
            </div>
          </div>
          <label class="auth-terms">
            <input type="checkbox" required>
            <span><a href="#">이용약관</a> 및 <a href="#">개인정보처리방침</a>에 동의합니다</span>
          </label>
          <button type="submit" class="btn btn-primary">가입하기</button>
        </form>

        <div class="auth-footer">
          이미 계정이 있으신가요? <a href="#" onclick="switchAuthForm('login'); return false;">로그인</a>
        </div>
      </div>
    </div>
  </div>`;
  
  document.body.insertAdjacentHTML('beforeend', modalHTML);
}

function openAuthModal(type = 'login') {
  createAuthModal();
  const modal = document.getElementById('auth-modal');
  if (modal) {
    modal.classList.add('show');
    document.body.style.overflow = 'hidden';
    switchAuthForm(type);
  }
}

function closeAuthModal() {
  const modal = document.getElementById('auth-modal');
  if (modal) {
    modal.classList.remove('show');
    document.body.style.overflow = '';
  }
}

function switchAuthForm(type) {
  const loginForm = document.getElementById('login-form');
  const signupForm = document.getElementById('signup-form');
  
  if (type === 'login') {
    if (loginForm) loginForm.classList.remove('hidden');
    if (signupForm) signupForm.classList.add('hidden');
  } else {
    if (loginForm) loginForm.classList.add('hidden');
    if (signupForm) signupForm.classList.remove('hidden');
  }
}

function togglePassword(inputId) {
  const input = document.getElementById(inputId);
  if (input) {
    input.type = input.type === 'password' ? 'text' : 'password';
  }
}

function toggleUserDropdown() {
  const dropdown = document.getElementById('user-dropdown');
  if (dropdown) {
    dropdown.classList.toggle('show');
  }
}

// Close dropdown when clicking outside
document.addEventListener('click', (e) => {
  const dropdown = document.getElementById('user-dropdown');
  const avatar = document.getElementById('user-avatar');
  if (dropdown && avatar && !avatar.contains(e.target) && !dropdown.contains(e.target)) {
    dropdown.classList.remove('show');
  }
});

// Social Login (Demo)
function socialLogin(provider) {
  // Demo: Simulate social login
  const demoUsers = {
    kakao: { name: '카카오 사용자', email: 'user@kakao.com', credits: 5, provider: 'kakao' },
    naver: { name: '네이버 사용자', email: 'user@naver.com', credits: 5, provider: 'naver' },
    google: { name: 'Google User', email: 'user@gmail.com', credits: 5, provider: 'google' }
  };

  const user = demoUsers[provider];
  if (user) {
    Auth.setUser(user);
    closeAuthModal();
    Toast.success(`${provider} 로그인 성공!`);
  }
}

// Email Login (Demo)
function emailLogin(event) {
  event.preventDefault();
  
  const email = document.getElementById('login-email')?.value;
  const password = document.getElementById('login-password')?.value;

  if (!email || !password) {
    Toast.error('이메일과 비밀번호를 입력해주세요');
    return;
  }

  // Demo: Simulate login
  const user = {
    name: email.split('@')[0],
    email: email,
    credits: 3,
    provider: 'email'
  };

  Auth.setUser(user);
  closeAuthModal();
  Toast.success('로그인 성공!');
}

// Email Signup (Demo)
function emailSignup(event) {
  event.preventDefault();
  
  const name = document.getElementById('signup-name')?.value;
  const email = document.getElementById('signup-email')?.value;
  const password = document.getElementById('signup-password')?.value;

  if (!name || !email || !password) {
    Toast.error('모든 항목을 입력해주세요');
    return;
  }

  if (password.length < 8) {
    Toast.error('비밀번호는 8자 이상이어야 합니다');
    return;
  }

  // Demo: Simulate signup with welcome credits
  const user = {
    name: name,
    email: email,
    credits: 5, // Welcome bonus
    provider: 'email'
  };

  Auth.setUser(user);
  closeAuthModal();
  Toast.success('회원가입 완료! 환영 크레딧 5개가 지급되었습니다 🎉');
}

// Logout
function logout() {
  Auth.clearUser();
  CreditManager.setBalance(0);
  Toast.success('로그아웃되었습니다');
  
  // Close dropdown
  const dropdown = document.getElementById('user-dropdown');
  if (dropdown) dropdown.classList.remove('show');
}

// ==========================================
// Exports (for use in other scripts)
// ==========================================
window.RewriteMoment = {
  Utils,
  DeviceManager,
  CreditManager,
  Toast,
  Modal,
  FormValidation,
  FileUpload,
  API,
  Pricing,
  Auth,
  CONFIG
};

