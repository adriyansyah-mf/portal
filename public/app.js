const form = document.querySelector('#password-form');
const message = document.querySelector('#form-message');
const submit = document.querySelector('#submit-button');
const nextPassword = document.querySelector('#new-password');
const confirmPassword = document.querySelector('#confirm-password');

for (const button of document.querySelectorAll('.visibility-toggle')) {
  button.addEventListener('click', () => {
    const input = document.getElementById(button.dataset.target);
    const visible = input.type === 'password';
    input.type = visible ? 'text' : 'password';
    button.textContent = visible ? 'Hide' : 'Show';
    button.setAttribute('aria-pressed', String(visible));
    button.setAttribute('aria-label', `${visible ? 'Hide' : 'Show'} ${input.labels[0].textContent.toLowerCase()}`);
  });
}

function validatePasswords() {
  confirmPassword.setCustomValidity(confirmPassword.value && confirmPassword.value !== nextPassword.value ? 'Your new passwords do not match.' : '');
  nextPassword.setCustomValidity(/[^\x20-\x7e]/.test(nextPassword.value) ? 'Use English letters, numbers, spaces, or symbols.' : '');
}
nextPassword.addEventListener('input', validatePasswords);
confirmPassword.addEventListener('input', validatePasswords);

form.addEventListener('submit', async event => {
  event.preventDefault();
  validatePasswords();
  if (!form.reportValidity()) return;
  message.hidden = true;
  submit.disabled = true;
  form.setAttribute('aria-busy', 'true');
  submit.firstElementChild.textContent = 'Updating password…';
  try {
    const response = await fetch('/api/change-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(Object.fromEntries(new FormData(form))),
      signal: AbortSignal.timeout(22000),
    });
    const result = await response.json();
    message.textContent = result.message;
    message.classList.toggle('success', response.ok);
    if (response.ok) {
      form.reset();
      for (const button of document.querySelectorAll('.visibility-toggle')) {
        if (button.getAttribute('aria-pressed') === 'true') button.click();
      }
    }
  } catch {
    message.classList.remove('success');
    message.textContent = 'We could not confirm the password change. Please check your connection. If you already submitted, try signing in with your new password before retrying.';
  } finally {
    submit.disabled = false;
    form.removeAttribute('aria-busy');
    submit.firstElementChild.textContent = 'Update password';
    message.hidden = false;
    message.focus();
  }
});
