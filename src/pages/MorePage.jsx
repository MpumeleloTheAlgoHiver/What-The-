import React, { useEffect, useState } from "react";
import {
  ArrowLeft,
  Settings,
  BadgeCheck,
  Landmark,
  ReceiptText,
  HelpCircle,
  Scale,
  ShieldCheck,
  LogOut,
  ChevronRight,
  AlertCircle,
  User,
  FileText,
  Users,
} from "lucide-react";
import { supabase } from "../lib/supabase";
import ProfileSkeleton from "../components/ProfileSkeleton";
import { useRequiredActions } from "../lib/useRequiredActions";
import { useSumsubStatus } from "../lib/useSumsubStatus";
import OriginButton from "../components/OriginButton";

const MorePage = ({ onNavigate }) => {
  const [loading, setLoading] = useState(true);
  const [profile, setProfile] = useState(null);
  const [error, setError] = useState("");
  const [subscriptionPlan, setSubscriptionPlan] = useState(null);
  const { bankLinked } = useRequiredActions();
  const { kycVerified, kycPending, kycNeedsResubmission } = useSumsubStatus();

  const displayName = [profile?.first_name || profile?.firstName, profile?.last_name || profile?.lastName]
    .filter(Boolean).join(" ");
  const displayUsername = profile?.email
    ? `@${profile.email.split("@")[0]}`
    : "";
  const initials = displayName
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();

  useEffect(() => {
    let alive = true;

    const loadProfile = async () => {
      try {
        if (!supabase) {
          if (alive) {
            setError("Supabase is not configured.");
            setLoading(false);
          }
          return;
        }

        const { data: userData, error: userError } = await supabase.auth.getUser();
        if (userError || !userData?.user) {
          if (alive) {
            setError("Unable to load profile.");
            setLoading(false);
          }
          return;
        }

        const { data: profileData, error: profileError } = await supabase
          .from("profiles")
          .select("first_name, last_name, email, avatar_url")
          .eq("id", userData.user.id)
          .maybeSingle();

        let plan = null;
        try {
          const { data: sub, error: subErr } = await supabase
            .from("subscriptions")
            .select("plan")
            .eq("user_id", userData.user.id)
            .eq("status", "active")
            .maybeSingle();
          if (!subErr && sub?.plan) plan = sub.plan;
        } catch (_) {}

        if (alive) {
          const metadata = userData.user.user_metadata || {};
          setProfile(profileData || {
            first_name: metadata.first_name || "",
            last_name: metadata.last_name || "",
            email: userData.user.email || "",
            avatar_url: metadata.avatar_url || "",
          });
          setSubscriptionPlan(plan || "free");
          setLoading(false);
        }
      } catch (err) {
        console.error("Failed to load profile", err);
        if (alive) {
          setError("Unable to load profile.");
          setLoading(false);
        }
      }
    };

    loadProfile();

    return () => {
      alive = false;
    };
  }, []);

  const handleLogout = async () => {
    try {
      if (supabase) {
        await supabase.auth.signOut();
      }
    } catch (error) {
      console.error("Failed to sign out:", error);
    } finally {
      onNavigate?.("welcome");
    }
  };

  const menuSections = [
    [
      { id: "profile", label: "Profile Details", icon: User, onClick: () => onNavigate?.("profileDetails") },
      { id: "family", label: "Family Dashboard", icon: Users, onClick: () => onNavigate?.("familyDashboard") },
      { id: "settings", label: "Settings", icon: Settings, onClick: () => onNavigate?.("settings") },
      { id: "statements", label: "Statements", icon: FileText, onClick: () => onNavigate?.("statements") },
    ],
    [
      { id: "help", label: "Help & FAQs", icon: HelpCircle },
      { id: "legal", label: "Legal Documentation", icon: Scale, onClick: () => onNavigate?.("legal") },
      { id: "subscriptions", label: "Manage Subscriptions", icon: ReceiptText, onClick: () => onNavigate?.("manageSubscriptions") },
      { id: "logout", label: "Log out", icon: LogOut, onClick: handleLogout },
    ],
  ];

  if (loading) {
    return <ProfileSkeleton />;
  }

  if (error) {
    return (
      <div className="min-h-screen bg-white px-6 pt-10 pb-24">
        <div className="rounded-2xl border border-slate-200 bg-white p-4 text-sm text-slate-500 shadow-sm">
          {error}
        </div>
      </div>
    );
  }

  const nameLabel = displayName || "Not set";
  const usernameLabel = displayUsername || "Not set";
  const iconColorClasses = "text-[#5b21b6]";

  return (
    <div className="min-h-screen bg-white px-6 pt-16 pb-24">
      <header className="mb-8 flex items-center">
        <OriginButton
          onClick={() => onNavigate?.("home")}
          circleColor="rgba(148,163,184,0.2)"
          className="flex h-10 w-10 items-center justify-center rounded-full bg-slate-100 text-slate-700 transition active:scale-95"
          aria-label="Back"
          disableTouch
        >
          <ArrowLeft className="h-5 w-5" />
        </OriginButton>
        <div className="flex flex-1 justify-center">
          {profile?.avatar_url ? (
            <img
              src={profile.avatar_url}
              alt={displayName || "Profile"}
              className="h-20 w-20 rounded-full border border-slate-200 object-cover"
            />
          ) : (
            <div className="flex h-20 w-20 items-center justify-center rounded-full bg-gradient-to-br from-violet-500 to-purple-600 text-lg font-semibold text-white">
              {initials || "—"}
            </div>
          )}
        </div>
        <div className="h-10 w-10" aria-hidden="true" />
      </header>

      <div className="flex flex-col items-center text-center">
        {subscriptionPlan && (
          <span
            className={`mt-2 inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-semibold ${
              subscriptionPlan === "premium" || subscriptionPlan === "pro"
                ? "bg-gradient-to-r from-violet-100 to-purple-100 text-violet-700 border border-violet-200"
                : "bg-slate-100 text-slate-600 border border-slate-200"
            }`}
          >
            {(subscriptionPlan === "premium" || subscriptionPlan === "pro") && (
              <svg viewBox="0 0 24 24" fill="currentColor" className="h-3.5 w-3.5">
                <path d="M12 2L15.09 8.26L22 9.27L17 14.14L18.18 21.02L12 17.77L5.82 21.02L7 14.14L2 9.27L8.91 8.26L12 2Z" />
              </svg>
            )}
            {subscriptionPlan.charAt(0).toUpperCase() + subscriptionPlan.slice(1)} Plan
          </span>
        )}
        <h2 className="mt-3 text-xl font-semibold text-slate-900">{nameLabel}</h2>
        <p className="mt-1 text-sm text-slate-500">{usernameLabel}</p>
        <OriginButton
          onClick={() => onNavigate?.("editProfile")}
          circleColor="rgba(255,255,255,0.12)"
          className="mt-5 rounded-full bg-slate-900 px-8 py-3 text-sm font-semibold text-white shadow-lg shadow-slate-900/20 transition active:scale-95"
          disableTouch
        >
          Edit Profile
        </OriginButton>
      </div>

      <div className="mt-8">
        <div className="mb-6 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex items-center justify-between gap-4">
            <div className="flex-1">
              <h2 className="text-base font-semibold text-slate-900">Required Actions</h2>
              <p className="mt-1 text-sm text-slate-500">Complete these to unlock all features</p>
            </div>
          </div>
          <div className="mt-4 space-y-3">
            <OriginButton
              onClick={() => onNavigate?.("actions")}
              circleColor="rgba(148,163,184,0.15)"
              className="flex w-full items-center justify-between rounded-xl bg-slate-50 px-3 py-2 text-left transition hover:bg-slate-100"
              disableTouch
            >
              <div className="flex items-center gap-2">
                <span className="flex h-10 w-10 items-center justify-center rounded-full bg-slate-100">
                  <ShieldCheck className={`h-5 w-5 ${iconColorClasses}`} />
                </span>
                <span className="text-sm font-medium text-slate-700">KYC Verification</span>
              </div>
              <span
                className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                  kycVerified
                    ? "bg-green-100 text-green-700"
                    : kycNeedsResubmission
                    ? "bg-amber-100 text-amber-700"
                    : kycPending
                    ? "bg-blue-100 text-blue-700"
                    : "bg-slate-100 text-slate-600"
                }`}
              >
                {kycVerified ? "Verified" : kycNeedsResubmission ? "Needs Attention" : kycPending ? "Pending" : "Not Verified"}
              </span>
            </OriginButton>
            <OriginButton
              onClick={() => onNavigate?.("bankLink")}
              circleColor="rgba(148,163,184,0.15)"
              className="flex w-full items-center justify-between rounded-xl bg-slate-50 px-3 py-2 text-left transition hover:bg-slate-100"
              disableTouch
            >
              <div className="flex items-center gap-2">
                <span className="flex h-10 w-10 items-center justify-center rounded-full bg-slate-100">
                  <Landmark className={`h-5 w-5 ${iconColorClasses}`} />
                </span>
                <span className="text-sm font-medium text-slate-700">Bank Account</span>
              </div>
              <span
                className={`rounded-full px-2 py-0.5 text-xs font-semibold ${bankLinked
                  ? "bg-green-100 text-green-700"
                  : "bg-amber-100 text-amber-700"
                  }`}
              >
                {bankLinked ? "Linked" : "Not Linked"}
              </span>
            </OriginButton>
          </div>
        </div>
      </div>

      <div className="space-y-6">
        {menuSections.map((section, sectionIndex) => (
          <div key={`section-${sectionIndex}`} className="border-t border-slate-200 pt-4">
            <div className="space-y-2">
              {section.map((item) => {
                const Icon = item.icon;
                return (
                  <OriginButton
                    key={item.id}
                    onClick={item.onClick}
                    circleColor="rgba(148,163,184,0.15)"
                    className="flex w-full items-center justify-between rounded-2xl px-2 py-3 text-left text-slate-700 transition hover:bg-slate-50 active:scale-[0.99]"
                    disableTouch
                  >
                    <div className="flex items-center gap-3">
                      <span className="flex h-6 w-6 items-center justify-center rounded-full bg-slate-100">
                        <Icon className={`h-5 w-5 ${iconColorClasses}`} />
                      </span>
                      <span className="text-base font-medium text-slate-800">{item.label}</span>
                    </div>
                    <ChevronRight className="h-5 w-5 text-slate-400" />
                  </OriginButton>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default MorePage;
