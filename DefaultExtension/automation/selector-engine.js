export function findByAccessibleName(name){return [...document.querySelectorAll('button,[role="button"],a,input')].find(e=>e.getAttribute('aria-label')===name||e.textContent?.trim()===name);}
