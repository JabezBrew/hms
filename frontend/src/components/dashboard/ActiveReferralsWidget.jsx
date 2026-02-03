import Send from 'lucide-react/dist/esm/icons/send.js';
import AlertCircle from 'lucide-react/dist/esm/icons/circle-alert.js';
import Clock from 'lucide-react/dist/esm/icons/clock.js';
import Eye from 'lucide-react/dist/esm/icons/eye.js';
import Building2 from 'lucide-react/dist/esm/icons/building-2.js';
import React from 'react';

import { cn } from '@/lib/utils';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import format from 'date-fns/format';
import { useReferralInbox, useReferralsSent } from '@/features/referrals/hooks';
import { useNavigate } from 'react-router-dom';

/**
 * ActiveReferralsWidget - Dashboard widget for active referrals
 *
 * Features:
 * - Shows both inbox and sent referrals
 * - Tab interface for switching views
 * - Urgency indicators
 * - Status badges
 * - Quick view action
 * - Chronicle design system styling
 */
export default function ActiveReferralsWidget({ className, limit = 5 }) {
  const navigate = useNavigate();

  const { data: inboxData } = useReferralInbox();
  const { data: sentData } = useReferralsSent();

  // Filter active referrals (not completed or declined)
  const activeInbox = (inboxData?.results || [])
    .filter((ref) => ['submitted', 'accepted', 'scheduled'].includes(ref.status))
    .slice(0, limit);

  const activeSent = (sentData?.results || [])
    .filter((ref) => ['submitted', 'accepted', 'scheduled'].includes(ref.status))
    .slice(0, limit);

  const handleViewReferral = (referralId, isInbox) => {
    if (isInbox) {
      navigate(`/referrals/inbox`);
    } else {
      navigate(`/referrals/sent`);
    }
  };

  const statusConfig = {
    submitted: { label: 'Pending', color: 'bg-sky-100 text-sky-700' },
    accepted: { label: 'Accepted', color: 'bg-emerald-100 text-emerald-700' },
    scheduled: { label: 'Scheduled', color: 'bg-violet-100 text-violet-700' },
  };

  const urgencyConfig = {
    routine: { label: 'Routine', color: 'text-stone-600', icon: Clock },
    urgent: { label: 'Urgent', color: 'text-amber-600', icon: AlertCircle },
    emergency: { label: 'Emergency', color: 'text-rose-600', icon: AlertCircle },
  };

  const ReferralList = ({ referrals, isInbox }) => (
    <div className="space-y-3">
      {referrals.length === 0 ? (
        <div className="text-center py-8 text-stone-500">
          <Send className="h-12 w-12 mx-auto mb-3 text-stone-300" />
          <p className="text-sm">No active referrals</p>
        </div>
      ) : (
        referrals.map((referral) => {
          const UrgencyIcon = urgencyConfig[referral.urgency].icon;
          return (
            <div
              key={referral.id}
              className="flex items-center justify-between p-3 bg-stone-50 border border-stone-200 rounded-lg hover:border-stone-300 transition-colors"
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1 flex-wrap">
                  <p className="font-mono text-sm font-semibold text-stone-900">
                    #{referral.referral_number}
                  </p>
                  <Badge className={statusConfig[referral.status].color} size="sm">
                    {statusConfig[referral.status].label}
                  </Badge>
                  <div className="flex items-center gap-1">
                    <UrgencyIcon
                      className={cn('h-3 w-3', urgencyConfig[referral.urgency].color)}
                    />
                    <span
                      className={cn(
                        'text-xs font-medium',
                        urgencyConfig[referral.urgency].color
                      )}
                    >
                      {urgencyConfig[referral.urgency].label}
                    </span>
                  </div>
                </div>
                <p className="text-sm text-stone-700 truncate">
                  {referral.patient_details?.first_name} {referral.patient_details?.last_name}
                </p>
                <div className="flex items-center gap-2 mt-1 text-xs text-stone-500">
                  <Building2 className="h-3 w-3" />
                  <span className="capitalize">
                    {referral.department?.replace(/_/g, ' ')}
                  </span>
                  <span>•</span>
                  <Clock className="h-3 w-3" />
                  {format(new Date(referral.created_at), 'MMM dd, yyyy')}
                </div>
                {referral.reason && (
                  <p className="text-xs text-stone-600 mt-1 truncate">{referral.reason}</p>
                )}
              </div>
              <Button
                size="sm"
                variant="outline"
                onClick={() => handleViewReferral(referral.id, isInbox)}
                className="ml-3"
              >
                <Eye className="h-4 w-4 mr-1" />
                View
              </Button>
            </div>
          );
        })
      )}
    </div>
  );

  return (
    <Card className={cn('border-stone-200 animate-chronicle-enter', className)}>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-violet-50 border border-violet-200">
              <Send className="h-5 w-5 text-violet-600" />
            </div>
            <div>
              <CardTitle className="text-lg font-heading">Active Referrals</CardTitle>
              <CardDescription>Referrals pending action</CardDescription>
            </div>
          </div>
          <Badge variant="outline" className="text-violet-700 border-violet-300">
            {activeInbox.length + activeSent.length}
          </Badge>
        </div>
      </CardHeader>
      <CardContent>
        <Tabs defaultValue="inbox" className="w-full">
          <TabsList className="grid w-full grid-cols-2 mb-4">
            <TabsTrigger value="inbox">
              Inbox
              {activeInbox.length > 0 && (
                <Badge className="ml-2 bg-violet-600" size="sm">
                  {activeInbox.length}
                </Badge>
              )}
            </TabsTrigger>
            <TabsTrigger value="sent">
              Sent
              {activeSent.length > 0 && (
                <Badge className="ml-2 bg-amber-600" size="sm">
                  {activeSent.length}
                </Badge>
              )}
            </TabsTrigger>
          </TabsList>
          <TabsContent value="inbox">
            <ReferralList referrals={activeInbox} isInbox={true} />
          </TabsContent>
          <TabsContent value="sent">
            <ReferralList referrals={activeSent} isInbox={false} />
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}
