import type React from 'react';
import { useState, useMemo, useCallback, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation, Outlet, useNavigate, Link } from 'react-router-dom';
import { debug, info, error } from '@/utils/logging';
import {
  Home,
  Activity, // Used for Check-In
  CalendarHeart,
  BarChart3,
  Utensils, // Used for Foods
  Settings as SettingsIcon,
  LogOut,
  Dumbbell, // Used for Exercises
  Target, // Used for Goals
  Pill, // Used for Medications
  Shield,
  MoreHorizontal,
  Coffee, // Used for Breakfast
  Sandwich, // Used for Lunch
  Cookie, // Used for Snacks
  UtensilsCrossed, // Used for Dinner
  Salad, // Used for Food Log
  BookOpen, // Used for the docs link
  Languages, // Used for the translation link
  HeartPulse, // Used for the delegate-only Symptoms page
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { toast } from '@/hooks/use-toast';

import SparkyChat from '../pages/Chat/SparkyChat';
import AddComp from '@/layouts/AddComp';
import ThemeToggle from '@/components/ThemeToggle';
import GlobalSyncButton from '@/components/GlobalSyncButton';
import ProfileSwitcher from '@/components/ProfileSwitcher';
import GitHubStarCounter from '@/components/GitHubStarCounter';
import GitHubSponsorButton from '@/components/GitHubSponsorButton';
import HeaderLinkPill from '@/components/HeaderLinkPill';
import GlobalNotificationIcon from '@/components/GlobalNotificationIcon';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/hooks/useAuth';
import { useActiveUser } from '@/contexts/ActiveUserContext';
import { usePreferences } from '@/contexts/PreferencesContext';
import { useMealTypes } from '@/hooks/Diary/useMealTypes';
import { useCurrentVersionQuery } from '@/hooks/useGeneralQueries';
import { useCycleSettings } from '@/hooks/useCycle';
import { cn } from '@/lib/utils';
import { getGridClassNormal } from '@/utils/layout';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

const SHOW_SPONSOR_BUTTON = false;

interface AddCompItem {
  value: string;
  label: string;
  icon: LucideIcon;
  fullWidth?: boolean;
}

interface MainLayoutProps {
  onShowAboutDialog: () => void;
  onShowNewReleaseDialog: () => void;
  onStartOnboarding?: () => void;
}

const MainLayout: React.FC<MainLayoutProps> = ({
  onShowAboutDialog,
  onShowNewReleaseDialog,
  onStartOnboarding,
}) => {
  const { t } = useTranslation();
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const {
    isActingOnBehalf,
    hasPermission,
    hasWritePermission,
    activeUserName,
  } = useActiveUser();
  const { getDateRelationToToday, loggingLevel } = usePreferences();
  debug(loggingLevel, 'MainLayout: Component rendered.');

  const { data: appVersion } = useCurrentVersionQuery();
  const [isAddCompOpen, setIsAddCompOpen] = useState(false);
  const [isTrainingOpen, setIsTrainingOpen] = useState(false);
  const [isMealTypeSelectOpen, setIsMealTypeSelectOpen] = useState(false);

  // Fetch meal types for quick log menu
  const { data: mealTypes } = useMealTypes();

  // Fetch cycle settings to determine tab visibility
  const { data: cycleSettings } = useCycleSettings();

  const handleSignOut = async () => {
    info(loggingLevel, 'MainLayout: Attempting to sign out.');
    try {
      await signOut();
      toast({
        title: t('common.success', 'Success'),
        description: t('auth.signedOut', 'Signed out successfully'),
      });
      navigate('/login'); // Navigate to login page after sign out
    } catch (err) {
      error(loggingLevel, 'MainLayout: Sign out error:', err);
      toast({
        title: t('common.error', 'Error'),
        description: t('auth.signOutFailed', 'Failed to sign out'),
        variant: 'destructive',
      });
    }
  };

  // Map meal type names to icons
  const getMealTypeIcon = useCallback((name: string): LucideIcon => {
    const lowerName = name.toLowerCase();
    switch (lowerName) {
      case 'breakfast':
        return Coffee;
      case 'lunch':
        return Sandwich;
      case 'dinner':
        return UtensilsCrossed;
      case 'snacks':
        return Cookie;
      default:
        return UtensilsCrossed; // Default icon for custom meal types
    }
  }, []);

  // Get display name for meal type
  const getMealTypeLabel = useCallback(
    (name: string): string => {
      const lowerName = name.toLowerCase();
      switch (lowerName) {
        case 'breakfast':
          return t('common.breakfast', 'Breakfast');
        case 'lunch':
          return t('common.lunch', 'Lunch');
        case 'dinner':
          return t('common.dinner', 'Dinner');
        case 'snacks':
          return t('common.snacks', 'Snacks');
        default:
          return name; // Custom meal types use their own name
      }
    },
    [t]
  );

  // Generate meal type items from API
  const mealTypeItems: AddCompItem[] = useMemo(() => {
    if (!mealTypes) return [];

    return mealTypes
      .filter((mt) => mt.show_in_quick_log !== false)
      .sort((a, b) => a.sort_order - b.sort_order)
      .map((mt) => ({
        value: mt.name.toLowerCase(),
        label: getMealTypeLabel(mt.name),
        icon: getMealTypeIcon(mt.name),
      }));
  }, [mealTypes, getMealTypeLabel, getMealTypeIcon]);

  const availableTabs = useMemo(() => {
    debug(loggingLevel, 'MainLayout: Calculating available tabs (desktop).', {
      isActingOnBehalf,
      hasPermission,
      hasWritePermission,
    });
    const tabs = [];
    if (!isActingOnBehalf) {
      tabs.push(
        { value: '/', label: t('nav.diary'), icon: Home },
        { value: '/checkin', label: t('nav.checkin'), icon: Activity }
      );
      if (cycleSettings?.enabled) {
        tabs.push({
          value: '/cycle',
          label: cycleSettings.discreet_mode
            ? t('nav.wellness', 'Wellness')
            : cycleSettings.mode === 'pregnant'
              ? t('nav.pregnancy', 'Pregnancy')
              : t('nav.cycle', 'Cycle'),
          icon: cycleSettings.discreet_mode ? Activity : CalendarHeart,
        });
      }
      tabs.push(
        {
          value: '/medications',
          label: t('nav.medications', 'Medications'),
          icon: Pill,
        },
        { value: '/reports', label: t('nav.reports'), icon: BarChart3 },
        { value: '/foods', label: t('nav.foods'), icon: Utensils },
        {
          value: '/exercises',
          label: t('exercise.title', 'Exercises'),
          icon: Dumbbell,
        },
        {
          value: '/training-programs',
          label: t('trainingPrograms.title', 'Training Programs'),
          icon: Dumbbell,
        },
        { value: '/goals', label: t('nav.goals'), icon: Target },
        { value: '/settings', label: t('nav.settings'), icon: SettingsIcon }
      );
    } else {
      if (hasWritePermission('diary')) {
        tabs.push({ value: '/', label: t('nav.diary'), icon: Home });
      }
      if (hasWritePermission('checkin')) {
        tabs.push({
          value: '/checkin',
          label: t('nav.checkin'),
          icon: Activity,
        });
      }
      if (hasPermission('reports')) {
        tabs.push({
          value: '/reports',
          label: t('nav.reports'),
          icon: BarChart3,
        });
      }
      if (hasWritePermission('can_manage_medications')) {
        tabs.push({
          value: '/medications',
          label: t('nav.medications', 'Medications'),
          icon: Pill,
        });
      }
      // Owners and check-in delegates reach symptoms from the Check-in page; a
      // delegate who may track symptoms but not check-ins gets their own entry.
      if (
        hasWritePermission('can_manage_symptoms') &&
        !hasWritePermission('checkin')
      ) {
        tabs.push({
          value: '/symptoms',
          label: t('nav.symptoms', 'Symptoms'),
          icon: HeartPulse,
        });
      }
    }
    if (hasPermission('diary')) {
      tabs.push({
        value: '/cardio-tests',
        label: t('cardioTests.title', 'Cardio Tests'),
        icon: HeartPulse,
      });
    }
    if (user?.role === 'admin' && !isActingOnBehalf) {
      tabs.push({ value: '/admin', label: t('nav.admin'), icon: Shield });
    }
    return tabs;
  }, [
    isActingOnBehalf,
    hasPermission,
    hasWritePermission,
    loggingLevel,
    user?.role,
    t,
    cycleSettings,
  ]);

  const availableMobileTabs = [
    ...availableTabs.filter((tab) => tab.value === '/'),
    ...(!isActingOnBehalf
      ? [
          {
            value: 'Training',
            label: t('nav.training', 'Training'),
            icon: Dumbbell,
          },
        ]
      : []),
    ...availableTabs.filter((tab) => tab.value === '/checkin'),
    { value: 'More', label: t('nav.more', 'More'), icon: MoreHorizontal },
  ];
  const moreTabs = availableTabs.filter(
    (tab) =>
      !['/', '/checkin', '/exercises', '/training-programs'].includes(tab.value)
  );
  const trainingTabs = availableTabs.filter((tab) =>
    ['/exercises', '/training-programs'].includes(tab.value)
  );

  const handleNavigateFromAddComp = useCallback(
    (value: string) => {
      info(loggingLevel, `MainLayout: Navigating to ${value} from AddComp.`);
      if (value === 'foodlog') {
        setIsAddCompOpen(false);
        setIsMealTypeSelectOpen(true);
      } else {
        navigate(value);
        setIsAddCompOpen(false);
      }
    },
    [loggingLevel, navigate]
  );

  const handleMealTypeSelect = useCallback(
    (mealType: string) => {
      info(
        loggingLevel,
        `MainLayout: Meal type ${mealType} selected, navigating to diary.`
      );
      debug(
        loggingLevel,
        `[MainLayout] Navigating to diary with meal type: ${mealType}`
      );
      setIsMealTypeSelectOpen(false);
      navigate('/', { state: { openFoodSearchForMeal: mealType } });
    },
    [loggingLevel, navigate]
  );

  const location = useLocation();

  // Whether the current route is reachable for the active profile. When acting
  // on behalf, a delegate only has a subset of tabs; landing on a disallowed
  // route (e.g. staying on Diary after switching to a checkin-only profile)
  // would otherwise mount that page and fire requests that 403.
  const isCurrentPathAllowed = useMemo(() => {
    if (!isActingOnBehalf || availableTabs.length === 0) {
      return true;
    }
    const currentPath = location.pathname;
    // Match exactly or as prefix (e.g. /medications/log should match /medications)
    return availableTabs.some((tab) => {
      if (tab.value === '/') {
        return (
          currentPath === '/' ||
          currentPath === '/workout-playback' ||
          currentPath.startsWith('/workout-playback/')
        );
      }
      return (
        currentPath === tab.value || currentPath.startsWith(tab.value + '/')
      );
    });
  }, [isActingOnBehalf, availableTabs, location.pathname]);

  useEffect(() => {
    if (!isCurrentPathAllowed) {
      const fallbackTab = availableTabs[0]?.value;
      if (fallbackTab) {
        debug(
          loggingLevel,
          `MainLayout: Redirecting from unauthorized path ${location.pathname} to ${fallbackTab}`
        );
        navigate(fallbackTab, { replace: true });
      }
    }
  }, [
    isCurrentPathAllowed,
    availableTabs,
    location.pathname,
    navigate,
    loggingLevel,
  ]);

  const selectedDate = new URLSearchParams(location.search).get('date');
  const selectedDateRelation = selectedDate
    ? getDateRelationToToday(selectedDate)
    : 'today';

  return (
    <div className="min-h-screen bg-background">
      <div className="container mx-auto px-4 sm:px-6">
        <header
          className={cn(
            'flex min-h-16 items-center justify-between gap-3 border-b pt-[env(safe-area-inset-top)]',
            location.pathname === '/' && 'max-md:hidden'
          )}
        >
          <Link
            to="/"
            className="flex min-h-11 min-w-11 items-center gap-2"
            aria-label={t('nav.diary')}
          >
            <img
              src="/images/SparkyFitness.webp"
              alt={t('mainLayout.sparkyFitnessLogo', 'SparkyFitness Logo')}
              width={30}
              height={40}
              className="shrink-0"
            />
            <span className="hidden sm:inline truncate text-base font-semibold tracking-tight">
              SparkyFitness
            </span>
          </Link>
          <div className="flex shrink-0 items-center gap-1">
            <GlobalNotificationIcon />
            <GlobalSyncButton />
            <ThemeToggle />
            <ProfileSwitcher />
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setIsAddCompOpen(true)}
              aria-label={t('nav.more', 'More')}
              className="hidden sm:inline-flex"
            >
              <MoreHorizontal />
            </Button>
          </div>
        </header>
        <nav
          className={cn(
            'relative hidden flex-wrap w-full gap-1 py-3 mb-6 border-b transition-colors',
            location.pathname === '/' ? 'md:flex' : 'sm:flex',
            selectedDateRelation === 'today' && 'border-border',
            selectedDateRelation === 'past' && 'border-date-past/40',
            selectedDateRelation === 'future' && 'border-date-future/40'
          )}
        >
          {selectedDateRelation !== 'today' && (
            <div
              className={cn(
                'absolute inset-0 pointer-events-none z-10',
                selectedDateRelation === 'past' && 'bg-date-past/10',
                selectedDateRelation === 'future' && 'bg-date-future/10'
              )}
            />
          )}
          {availableTabs.map(({ value, label, icon: Icon }) => (
            <Button
              key={value}
              variant="ghost"
              className={`relative flex items-center gap-2 hover:bg-accent transition-colors ${
                location.pathname === value
                  ? 'bg-accent text-primary'
                  : 'text-muted-foreground'
              }`}
              aria-current={location.pathname === value ? 'page' : undefined}
              onClick={() => navigate(value)}
            >
              <Icon className="h-4 w-4" />
              <span>{label}</span>
            </Button>
          ))}
        </nav>

        <nav
          aria-label={t('nav.primaryNavigation', 'Primary navigation')}
          className={cn(
            'apple-safe-area fixed bottom-0 inset-x-0 z-40 border-t bg-background/90 backdrop-blur-xl',
            location.pathname === '/' ? 'md:hidden' : 'sm:hidden',
            selectedDateRelation === 'past' && 'border-date-past/80',
            selectedDateRelation === 'future' && 'border-date-future/50'
          )}
        >
          <div
            className={cn(
              'grid min-h-16 items-stretch px-2',
              getGridClassNormal(availableMobileTabs.length)
            )}
          >
            {availableMobileTabs.map(({ value, label, icon: Icon }) => {
              const active =
                value === 'Training'
                  ? location.pathname.startsWith('/exercises') ||
                    location.pathname.startsWith('/training-programs') ||
                    location.pathname.startsWith('/workout-playback')
                  : value === 'More'
                    ? moreTabs.some((tab) =>
                        location.pathname.startsWith(tab.value)
                      )
                    : location.pathname === value;
              return (
                <Button
                  key={value}
                  variant="ghost"
                  aria-current={active ? 'page' : undefined}
                  aria-expanded={
                    value === 'More'
                      ? isAddCompOpen
                      : value === 'Training'
                        ? isTrainingOpen
                        : undefined
                  }
                  className={cn(
                    'h-auto min-h-16 min-w-0 flex-1 flex-col gap-1 rounded-none px-1 py-2 text-xs [&_svg]:size-5',
                    active ? 'text-primary' : 'text-muted-foreground'
                  )}
                  onClick={() => {
                    if (value === 'More') setIsAddCompOpen(true);
                    else if (value === 'Training') setIsTrainingOpen(true);
                    else navigate(value);
                  }}
                >
                  <Icon aria-hidden="true" />
                  <span>{label}</span>
                </Button>
              );
            })}
          </div>
        </nav>

        <main
          className={cn(
            'min-w-0 pt-6 pb-[calc(5rem+env(safe-area-inset-bottom))] sm:pt-0 sm:pb-0',
            location.pathname === '/' &&
              'max-md:pt-0 max-md:pb-[calc(5rem+env(safe-area-inset-bottom))]'
          )}
        >
          {/* Avoid mounting disallowed pages while the profile redirect runs. */}
          {isCurrentPathAllowed ? <Outlet /> : null}
        </main>

        <SparkyChat />
      </div>

      <Dialog open={isAddCompOpen} onOpenChange={setIsAddCompOpen}>
        <DialogContent
          className="max-h-[calc(100dvh-2rem)] overflow-y-auto"
          aria-describedby={undefined}
        >
          <DialogHeader>
            <DialogTitle>{t('nav.more', 'More')}</DialogTitle>
          </DialogHeader>
          {location.pathname === '/' && (
            <div className="flex items-center gap-2 md:hidden">
              <Link
                to="/"
                onClick={() => setIsAddCompOpen(false)}
                className="flex min-h-11 min-w-11 items-center gap-2"
                aria-label={t('nav.diary')}
              >
                <img
                  src="/images/SparkyFitness.webp"
                  alt={t('mainLayout.sparkyFitnessLogo', 'SparkyFitness Logo')}
                  width={30}
                  height={40}
                />
                <span>SparkyFitness</span>
              </Link>
              <GlobalNotificationIcon />
              <GlobalSyncButton />
            </div>
          )}
          <p className="text-sm text-muted-foreground">
            {t('layout.welcome', 'Welcome {{activeUserName}}', {
              activeUserName,
            })}
          </p>
          <div className="grid grid-cols-2 gap-2">
            {moreTabs.map(({ value, label, icon: Icon }) => (
              <Button
                key={value}
                variant="ghost"
                className="h-auto min-h-11 justify-start whitespace-normal text-left"
                onClick={() => handleNavigateFromAddComp(value)}
              >
                <Icon aria-hidden="true" />
                {label}
              </Button>
            ))}
            {(!isActingOnBehalf || hasWritePermission('diary')) && (
              <Button
                variant="outline"
                className="col-span-2"
                onClick={() => handleNavigateFromAddComp('foodlog')}
              >
                <Salad />
                {t('nav.foodLog', 'Food Log')}
              </Button>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2 border-t pt-4">
            {onStartOnboarding && (
              <Button
                variant="outline"
                onClick={() => {
                  setIsAddCompOpen(false);
                  onStartOnboarding();
                }}
              >
                {t('onboarding.completeSetup', 'Complete Setup')}
              </Button>
            )}
            <Button variant="outline" onClick={handleSignOut}>
              <LogOut />
              {t('auth.signOut', 'Sign Out')}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
      <AddComp
        isVisible={isTrainingOpen}
        onClose={() => setIsTrainingOpen(false)}
        items={trainingTabs}
        onNavigate={(value) => navigate(value)}
        title={t('nav.training', 'Training')}
      />

      <AddComp
        isVisible={isMealTypeSelectOpen}
        onClose={() => setIsMealTypeSelectOpen(false)}
        items={mealTypeItems}
        onNavigate={handleMealTypeSelect}
        title={t('foodDiary.selectMealType', 'Select Meal Type')}
      />

      <footer className="text-center text-muted-foreground text-sm py-4">
        {
          <div className="flex flex-col items-center gap-2 mb-[calc(4rem+env(safe-area-inset-bottom))] sm:mb-0">
            <div className="flex flex-wrap justify-center gap-2">
              <GitHubStarCounter owner="CodeWithCJ" repo="SparkyFitness" />
              {SHOW_SPONSOR_BUTTON && (
                <GitHubSponsorButton owner="CodeWithCJ" />
              )}
              <HeaderLinkPill
                href="https://codewithcj.github.io/SparkyFitness/"
                label={t('layout.docs', 'Docs')}
                icon={BookOpen}
              />
              <HeaderLinkPill
                href="https://weblate.sparkyfitness.com/engage/sparkyfitness/"
                label={t('layout.translate', 'Translate')}
                icon={Languages}
              />
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                className="touch-target cursor-pointer underline bg-transparent border-0 p-0 text-inherit font-normal text-sm"
                onClick={onShowAboutDialog}
              >
                {t('nav.sparkyFitnessV', 'SparkyFitness v{{version}}', {
                  version: appVersion?.version ?? '',
                })}
              </button>
              <span>•</span>
              <button
                type="button"
                className="touch-target cursor-pointer underline hover:text-foreground bg-transparent border-0 p-0 text-inherit font-normal text-sm"
                onClick={onShowNewReleaseDialog}
              >
                {t('release.whatsNew', "What's New")}
              </button>
            </div>
          </div>
        }
      </footer>
    </div>
  );
};

export default MainLayout;
