async function hydrateBusiness(){
  try{
    const response=await fetch('/api/public-config',{cache:'no-store'}),data=await response.json(),business=data.business||{};
    document.querySelectorAll('[data-business-name]').forEach(node=>node.textContent=business.name||'Quartz Web Solutions');
    document.querySelectorAll('[data-support-email]').forEach(node=>{node.textContent=business.supportEmail||'Not configured';if(node.tagName==='A')node.href=`mailto:${business.supportEmail}`});
    document.querySelectorAll('[data-support-phone]').forEach(node=>{node.textContent=business.supportPhone||'Not configured';if(node.tagName==='A')node.href=`tel:${String(business.supportPhone||'').replace(/\s/g,'')}`});
    document.querySelectorAll('[data-business-address]').forEach(node=>node.textContent=business.address||'Malappuram, Kerala, India');
  }catch{}
}
hydrateBusiness();
