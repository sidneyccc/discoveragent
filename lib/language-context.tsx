import { createContext, useContext, useMemo, useState } from 'react';

export type AppLanguage = 'zh' | 'en';

type AppLanguageContextValue = {
  language: AppLanguage;
  setLanguage: (language: AppLanguage) => void;
  preferredLocale: string;
};

const AppLanguageContext = createContext<AppLanguageContextValue | null>(null);

export function AppLanguageProvider({ children }: { children: React.ReactNode }) {
  const [language, setLanguage] = useState<AppLanguage>('zh');

  const value = useMemo<AppLanguageContextValue>(
    () => ({
      language,
      setLanguage,
      preferredLocale: language === 'zh' ? 'zh-CN' : 'en-US',
    }),
    [language]
  );

  return <AppLanguageContext.Provider value={value}>{children}</AppLanguageContext.Provider>;
}

export function useAppLanguage() {
  const context = useContext(AppLanguageContext);
  if (!context) {
    throw new Error('useAppLanguage must be used within AppLanguageProvider');
  }
  return context;
}

