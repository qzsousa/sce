const BANNER_ID = 'sce-maintenance-banner';

function inserirBanner() {
  if (document.getElementById(BANNER_ID)) return;
  if (!document.body) return;
  const banner = document.createElement('div');
  banner.id = BANNER_ID;
  banner.style.cssText = 'background:#fff3cd;color:#856404;padding:10px 16px;text-align:center;font-size:.9rem;border-bottom:1px solid #ffeeba;font-family:Inter,system-ui,sans-serif;';
  banner.textContent = 'Aviso: o SCE estará em manutenção das 16:30 às 19:30.';
  document.body.insertBefore(banner, document.body.firstChild);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', inserirBanner);
} else {
  inserirBanner();
}
