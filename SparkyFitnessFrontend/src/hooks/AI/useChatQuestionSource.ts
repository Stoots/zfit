import { useAui, useAuiState } from '@assistant-ui/react';
import { useLayoutEffect } from 'react';

export function useChatQuestionSource() {
  const aui = useAui();
  const type = useAuiState((s) => s.composer.type);
  const source = useAuiState(
    (s) => s.composer.runConfig.custom?.['trainingAnalysisSource']
  );
  useLayoutEffect(() => {
    if (source === type) return;
    const config = aui.composer.getState().runConfig;
    // Edit composers inherit the main composer's config; stamp their actual runtime type.
    aui.composer.setRunConfig({
      ...config,
      custom: { ...config.custom, trainingAnalysisSource: type },
    });
  }, [aui, type, source]);
}
