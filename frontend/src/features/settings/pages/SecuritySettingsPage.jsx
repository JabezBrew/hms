import Shield from 'lucide-react/dist/esm/icons/shield.js';
import ArrowLeft from 'lucide-react/dist/esm/icons/arrow-left.js';
import Key from 'lucide-react/dist/esm/icons/key.js';
import Monitor from 'lucide-react/dist/esm/icons/monitor.js';
import Smartphone from 'lucide-react/dist/esm/icons/smartphone.js';
import { useNavigate } from 'react-router-dom';
import { Helmet } from 'react-helmet-async';

import { Button } from '@/components/ui/button';
import ChangePasswordForm from '@/components/settings/ChangePasswordForm';
import SessionManagement from '@/components/settings/SessionManagement';
import MFAStatus from '@/components/settings/MFAStatus';

/**
 * SecuritySettingsPage - Password, MFA, and session management
 * Chronicle Design: Rose accent for security, editorial typography
 */
const SecuritySettingsPage = () => {
  const navigate = useNavigate();

  return (
    <>
      <Helmet>
        <title>Security Settings | HMS</title>
        <meta name="description" content="Manage your security settings" />
      </Helmet>

      <div className="min-h-screen bg-background">
        {/* Page Header - Chronicle style with rose accent */}
        <header className="bg-card border-b border-border px-4 sm:px-6 py-6">
          <div className="max-w-2xl mx-auto">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => navigate('/settings')}
              className="mb-4 -ml-2 font-mono text-xs"
            >
              <ArrowLeft className="h-4 w-4 mr-2" />
              Back to Settings
            </Button>

            <div className="flex items-center gap-3 sm:gap-4">
              <div className="p-2.5 sm:p-3 rounded-xl bg-rose-500/10 border border-rose-500/20">
                <Shield className="h-6 w-6 sm:h-7 sm:w-7 text-rose-400" aria-hidden="true" />
              </div>
              <div>
                <h1 className="font-display text-2xl sm:text-3xl text-foreground tracking-tight">
                  Security
                </h1>
                <p className="text-xs sm:text-sm text-muted-foreground font-mono mt-0.5">
                  Protect your account with strong security settings
                </p>
              </div>
            </div>
          </div>
        </header>

        {/* Main Content */}
        <main className="p-4 sm:p-6 lg:p-8">
          <div className="max-w-2xl mx-auto space-y-6">
            {/* Change Password Section */}
            <section className="bg-card border border-border rounded-2xl p-5 sm:p-6 animate-chronicle-enter">
              <div className="flex items-center gap-3 mb-2">
                <div className="p-2 rounded-lg bg-rose-500/10 border border-rose-500/20">
                  <Key className="h-4 w-4 text-rose-400" aria-hidden="true" />
                </div>
                <h2 className="font-display text-lg text-foreground">
                  Change Password
                </h2>
              </div>
              <p className="text-sm text-muted-foreground mb-5 ml-11">
                Update your password regularly to keep your account secure.
              </p>
              <div className="ml-11">
                <ChangePasswordForm />
              </div>
            </section>

            {/* Active Sessions Section */}
            <section className="bg-card border border-border rounded-2xl p-5 sm:p-6 animate-chronicle-enter" style={{ animationDelay: '75ms' }}>
              <div className="flex items-center gap-3 mb-2">
                <div className="p-2 rounded-lg bg-sky-500/10 border border-sky-500/20">
                  <Monitor className="h-4 w-4 text-sky-400" aria-hidden="true" />
                </div>
                <h2 className="font-display text-lg text-foreground">
                  Active Sessions
                </h2>
              </div>
              <p className="text-sm text-muted-foreground mb-5 ml-11">
                These are the devices currently logged into your account. Sign out any session you don&apos;t recognize.
              </p>
              <div className="ml-11">
                <SessionManagement />
              </div>
            </section>

            {/* MFA Section */}
            <section className="bg-card border border-border rounded-2xl p-5 sm:p-6 animate-chronicle-enter" style={{ animationDelay: '150ms' }}>
              <div className="flex items-center gap-3 mb-2">
                <div className="p-2 rounded-lg bg-emerald-500/10 border border-emerald-500/20">
                  <Smartphone className="h-4 w-4 text-emerald-400" aria-hidden="true" />
                </div>
                <h2 className="font-display text-lg text-foreground">
                  Multi-Factor Authentication
                </h2>
              </div>
              <p className="text-sm text-muted-foreground mb-5 ml-11">
                Add an extra layer of security by requiring a verification code in addition to your password.
              </p>
              <div className="ml-11">
                <MFAStatus />
              </div>
            </section>
          </div>
        </main>
      </div>
    </>
  );
};

export default SecuritySettingsPage;
