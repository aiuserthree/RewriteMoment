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
  CONFIG
};

