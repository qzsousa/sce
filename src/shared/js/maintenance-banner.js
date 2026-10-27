const BANNER_ID = 'sce-maintenance-banner';

function inserirBanner() {
  if (document.getElementById(BANNER_ID)) return;
  if (!document.body) return;
  const banner = document.createElement('div');
  banner.id = BANNER_ID;
  banner.style.cssText = 'position:sticky;top:0;z-index:101;background:#d32f2f;color:#fff;padding:14px 16px;text-align:center;font-size:1rem;font-weight:700;border-bottom:2px solid #b71c1c;font-family:Inter,system-ui,sans-serif;';
  banner.textContent = 'AVISO: o SCE estará em manutenção das 17:00 às 20:00.';
  document.body.insertBefore(banner, document.body.firstChild);
  const header = document.querySelector('.sce-header');
  if (header) header.style.top = banner.offsetHeight + 'px';
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', inserirBanner);
} else {
  inserirBanner();
}
