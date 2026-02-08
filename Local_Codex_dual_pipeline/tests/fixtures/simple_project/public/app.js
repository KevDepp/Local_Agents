(() => {
  const form = document.querySelector('#prompt-form');
  const promptInput = document.querySelector('#prompt');
  const output = document.querySelector('#output');
  const stepsList = document.querySelector('#steps');
  const error = document.querySelector('#error');
  const status = document.querySelector('#status');

  const baseSteps = [
    'Open the target screen.',
    'Perform the primary action.',
    'Verify the success message.'
  ];

  const renderSteps = (steps) => {
    stepsList.innerHTML = '';
    steps.forEach((step) => {
      const item = document.createElement('li');
      item.textContent = step;
      stepsList.appendChild(item);
    });
  };

  const setError = (message) => {
    error.textContent = message;
    const isVisible = Boolean(message);
    error.hidden = !isVisible;
    error.setAttribute('aria-hidden', (!isVisible).toString());
  };

  const setOutput = (message) => {
    output.textContent = message;
  };

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const promptText = promptInput.value.trim();

    if (!promptText) {
      setError('Please enter a UI test prompt.');
      setOutput('');
      renderSteps([]);
      status.textContent = 'Awaiting prompt.';
      return;
    }

    setError('');
    setOutput(`Scenario ready: ${promptText}`);
    renderSteps(baseSteps);
    status.textContent = `${baseSteps.length} steps ready for execution.`;
  });
})();
