const button=document.getElementById('deleteAccountBtn'),password=document.getElementById('deletePassword'),status=document.getElementById('deleteStatus');
button.addEventListener('click',async()=>{
  if(!password.value){status.textContent='Enter your current password.';password.focus();return}
  if(!window.confirm('Permanently delete this PlayVerse account? This cannot be undone.'))return;
  button.disabled=true;status.textContent='Deleting account…';
  try{const response=await fetch('/api/auth/account',{method:'DELETE',headers:{'content-type':'application/json'},credentials:'same-origin',body:JSON.stringify({password:password.value})}),data=await response.json();if(!response.ok){status.textContent=data.error||'Could not delete the account.';button.disabled=false;return}localStorage.removeItem('playverse_room_resume_v1');sessionStorage.clear();status.textContent='Account deleted. Returning to PlayVerse…';setTimeout(()=>location.href='/',900)}catch{status.textContent='Could not connect. Try again.';button.disabled=false}
});
