export const providerDefaults = {
  ollama: {
    url: 'http://127.0.0.1:11434',
    model: 'llama3.2:latest',
  },
  openai: {
    url: 'https://api.openai.com/v1',
    model: 'gpt-4o',
  },
  mistral: {
    url: 'https://api.mistral.ai',
    model: 'mistral-medium-2508',
  },
};

export function initProviderDefaults(elements) {
  function updateDefaults() {
    const provider = elements.llmProvider.value;
    const defaults = providerDefaults[provider];

    if (defaults) {
      const currentUrl = elements.providerUrl.value;
      const currentModel = elements.modelName.value;

      const isDefaultUrl = Object.values(providerDefaults).some(
        (p) => p.url === currentUrl
      );
      const isDefaultModel = Object.values(providerDefaults).some(
        (p) => p.model === currentModel
      );

      if (isDefaultUrl) {
        elements.providerUrl.value = defaults.url;
      }
      if (isDefaultModel) {
        elements.modelName.value = defaults.model;
      }
    }
  }

  elements.llmProvider.addEventListener('change', updateDefaults);

  updateDefaults();
}
