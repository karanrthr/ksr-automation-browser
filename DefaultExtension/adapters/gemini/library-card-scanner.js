// Library cards are fingerprinted from stable visible data; service-worker duplicate checks reuse these fingerprints.
export function libraryFingerprint({src='',alt='',href='',index=0,width=0,height=0,text=''}){return btoa(unescape(encodeURIComponent([src,alt,href,index,width,height,text.slice(0,120)].join('|')))).slice(0,240);}
