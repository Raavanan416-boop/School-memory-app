// Enhanced SPA Router with sub-routes, modals, and back navigation
class Router {
  constructor() {
    this.routes = {};
    this.currentPage = null;
    this.currentSub = null;
    this.container = null;
    this.history = [];
    this.modalStack = [];
    this.onNavigate = null;
    this.destroyHooks = {};
  }

  setContainer(el) { this.container = el; }

  register(name, renderFn) { this.routes[name] = renderFn; }

  registerDestroy(name, destroyFn) { this.destroyHooks[name] = destroyFn; }

  async navigate(page, data = null) {
    if (!this.container || !this.routes[page]) return;

    // Skip if already on this page with no new data (avoid double-tapping tab)
    if (this.currentPage === page && !data && !this._isBackNav) return;
    this._isBackNav = false;

    // Save history
    if (this.currentPage) {
      this.history.push({ page: this.currentPage, sub: this.currentSub });
      
      // CRITICAL: Clean up previous page to prevent memory leaks and duplicate Firebase listeners
      if (this.destroyHooks[this.currentPage]) {
        try {
          this.destroyHooks[this.currentPage]();
        } catch (e) {
          console.error(`Error destroying page ${this.currentPage}:`, e);
        }
      }
    }

    // Close any open modals
    this.closeAllModals();

    // Exit animation
    if (this.container.children.length) {
      const child = this.container.children[0];
      if (child) {
        child.classList.add('page-exit');
        await new Promise(r => setTimeout(r, 200));
      }
    }

    this.currentPage = page;
    this.currentSub = null;
    this.container.innerHTML = '';

    const wrapper = document.createElement('div');
    wrapper.className = 'page-enter';
    wrapper.id = `page-${page}`;
    this.container.appendChild(wrapper);

    await this.routes[page](wrapper, data);

    // Update nav
    document.querySelectorAll('.nav-btn').forEach(b => {
      b.classList.toggle('active', b.dataset.page === page);
    });

    // Callback
    if (this.onNavigate) this.onNavigate(page, data);

    // Scroll to top
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  async navigateBack() {
    if (this.modalStack.length > 0) {
      this.closeModal();
      return true;
    }
    if (this.history.length > 0) {
      const prev = this.history.pop();
      this._isBackNav = true;
      const oldPage = this.currentPage;
      this.currentPage = null; // Reset to allow navigation
      await this.navigate(prev.page);
      return true;
    }
    return false;
  }

  openModal(content, options = {}) {
    const {
      title = '',
      fullscreen = false,
      onClose = null,
      className = ''
    } = options;

    const overlay = document.createElement('div');
    overlay.className = `modal-overlay ${fullscreen ? 'modal-fullscreen' : ''} ${className}`;
    overlay.innerHTML = `
      <div class="modal-backdrop"></div>
      <div class="modal-content ${fullscreen ? 'modal-content-full' : 'modal-content-sheet'}">
        ${title ? `
          <div class="modal-header">
            <h3 class="modal-title">${title}</h3>
            <button class="modal-close-btn" aria-label="Close">
              <svg class="w-6 h-6" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12"/>
              </svg>
            </button>
          </div>
        ` : `
          <button class="modal-close-btn modal-close-floating" aria-label="Close">
            <svg class="w-6 h-6" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12"/>
            </svg>
          </button>
        `}
        <div class="modal-body"></div>
      </div>
    `;

    const body = overlay.querySelector('.modal-body');
    if (typeof content === 'string') {
      body.innerHTML = content;
    } else if (content instanceof HTMLElement) {
      body.appendChild(content);
    }

    // Close handlers
    const close = () => {
      overlay.classList.add('modal-closing');
      setTimeout(() => {
        overlay.remove();
        this.modalStack = this.modalStack.filter(m => m !== overlay);
        if (onClose) onClose();
      }, 300);
    };

    overlay.querySelector('.modal-close-btn')?.addEventListener('click', close);
    overlay.querySelector('.modal-backdrop')?.addEventListener('click', (e) => {
      if (!fullscreen) close();
    });

    document.body.appendChild(overlay);
    this.modalStack.push(overlay);

    // Trigger enter animation
    requestAnimationFrame(() => overlay.classList.add('modal-active'));

    return { close, body, overlay };
  }

  closeModal() {
    if (this.modalStack.length > 0) {
      const modal = this.modalStack[this.modalStack.length - 1];
      modal.classList.add('modal-closing');
      setTimeout(() => {
        modal.remove();
        this.modalStack.pop();
      }, 300);
    }
  }

  closeAllModals() {
    this.modalStack.forEach(modal => {
      modal.classList.add('modal-closing');
      setTimeout(() => modal.remove(), 300);
    });
    this.modalStack = [];
  }

  getCurrentPage() { return this.currentPage; }
}

export const router = new Router();
