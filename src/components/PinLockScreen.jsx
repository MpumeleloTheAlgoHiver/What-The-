import React, { useState, useCallback, useEffect } from 'react';
import { Delete, Fingerprint } from 'lucide-react';
import { verifyPin, getPinEmail } from '../lib/usePin';
import { supabase } from '../lib/supabase';
import {
  isBiometricsEnabled,
  isBiometricsAvailable,
  authenticateWithBiometrics,
  getBiometryTypeName,
  isNativePlatform,
} from '../lib/biometrics';

const PIN_LENGTH = 5;
const MAX_ATTEMPTS = 3;

const PinDots = ({ filled, shake }) => (
  <div className={`flex items-center justify-center gap-4 ${shake ? 'animate-shake' : ''}`}>
    {Array.from({ length: PIN_LENGTH }).map((_, i) => (
      <div
        key={i}
        className={`h-4 w-4 rounded-full border-2 transition-all duration-200 ${
          i < filled
            ? 'border-slate-900 bg-slate-900 scale-110'
            : 'border-slate-200 bg-transparent'
        }`}
      />
    ))}
  </div>
);

const NumberPad = ({ onPress, onDelete }) => {
  const keys = [
    ['1', '2', '3'],
    ['4', '5', '6'],
    ['7', '8', '9'],
    ['', '0', 'delete'],
  ];

  return (
    <div className="mx-auto grid w-full max-w-xs grid-cols-3 gap-4">
      {keys.flat().map((key, i) => {
        if (key === '') return <div key={i} />;
        if (key === 'delete') {
          return (
            <button
              key={i}
              type="button"
              onClick={onDelete}
              className="flex h-16 w-16 items-center justify-center rounded-full text-slate-700 transition active:scale-90 active:bg-slate-100 mx-auto"
            >
              <Delete className="h-6 w-6" />
            </button>
          );
        }
        return (
          <button
            key={i}
            type="button"
            onClick={() => onPress(key)}
            className="flex h-16 w-16 items-center justify-center rounded-full bg-white text-2xl font-semibold text-slate-900 shadow-sm transition active:scale-90 active:bg-slate-50 mx-auto"
          >
            {key}
          </button>
        );
      })}
    </div>
  );
};

const PinLockScreen = ({ onUnlock, onLogout, userEmail, userAvatar, userName }) => {
  const [pin, setPin] = useState('');
  const [shake, setShake] = useState(false);
  const [attempts, setAttempts] = useState(0);
  const [biometricsAvailable, setBiometricsAvailable] = useState(false);
  const [biometryType, setBiometryType] = useState(null);

  const email = userEmail || getPinEmail() || '';
  const initials = (userName || email.split('@')[0] || '')
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((s) => s[0])
    .join('')
    .toUpperCase();

  useEffect(() => {
    const checkBiometrics = async () => {
      if (!isNativePlatform()) return;
      const enabled = isBiometricsEnabled();
      if (!enabled) return;
      const { available, biometryType: type } = await isBiometricsAvailable();
      setBiometricsAvailable(available && enabled);
      setBiometryType(type);
    };
    checkBiometrics();
  }, []);

  const triggerShake = () => {
    setShake(true);
    setTimeout(() => setShake(false), 600);
  };

  const handleLogout = async () => {
    try {
      if (supabase) {
        await supabase.auth.signOut({ scope: 'local' });
      }
    } catch (e) {
      console.error('Sign out failed:', e);
    }
    onLogout?.();
  };

  const handlePress = useCallback(
    (digit) => {
      if (pin.length < PIN_LENGTH) {
        const newPin = pin + digit;
        setPin(newPin);
        if (newPin.length === PIN_LENGTH) {
          verifyPin(newPin).then((valid) => {
            if (valid) {
              onUnlock?.();
            } else {
              const newAttempts = attempts + 1;
              setAttempts(newAttempts);
              triggerShake();
              setTimeout(() => setPin(''), 600);
              if (newAttempts >= MAX_ATTEMPTS) {
                handleLogout();
              }
            }
          });
        }
      }
    },
    [pin, attempts, onUnlock]
  );

  const handleDelete = useCallback(() => {
    setPin((prev) => prev.slice(0, -1));
  }, []);

  const handleBiometricAuth = async () => {
    try {
      const biometryName = getBiometryTypeName(biometryType);
      await authenticateWithBiometrics(`Use ${biometryName} to unlock`);
      onUnlock?.();
    } catch (err) {
      console.error('Biometric auth failed:', err);
    }
  };

  return (
    <div className="fixed inset-0 z-[9998] flex flex-col bg-slate-50">
      <div className="flex flex-1 flex-col items-center justify-center px-8">
        <div className="flex items-center gap-3 mb-8">
          <img src="/assets/mint-logo.svg" alt="Mint" className="h-6 w-auto" />
          <span className="mint-brand text-lg font-semibold tracking-[0.12em]">MINT</span>
        </div>

        {userAvatar ? (
          <img
            src={userAvatar}
            alt=""
            className="h-20 w-20 rounded-full border-2 border-slate-200 object-cover"
          />
        ) : (
          <div className="flex h-20 w-20 items-center justify-center rounded-full border-2 border-slate-300 bg-gradient-to-br from-slate-200 to-slate-300 text-xl font-bold text-slate-600 shadow-sm">
            {initials || '?'}
          </div>
        )}

        {email && <p className="mt-3 text-sm text-slate-500">{email}</p>}

        <p className="mt-6 text-center text-sm text-slate-400">
          {attempts > 0
            ? `Wrong PIN. ${MAX_ATTEMPTS - attempts} attempt${MAX_ATTEMPTS - attempts !== 1 ? 's' : ''} remaining.`
            : 'Enter your PIN to unlock'}
        </p>

        <div className="mt-6">
          <PinDots filled={pin.length} shake={shake} />
        </div>

        <div className="mt-10 w-full">
          <NumberPad onPress={handlePress} onDelete={handleDelete} />
        </div>

        <div className="mt-8 flex flex-col items-center gap-3">
          {biometricsAvailable && (
            <button
              type="button"
              onClick={handleBiometricAuth}
              className="flex items-center gap-2 rounded-full bg-slate-900 px-5 py-2.5 text-sm font-medium text-white shadow-sm transition active:scale-95"
            >
              <Fingerprint className="h-5 w-5" />
              Use {getBiometryTypeName(biometryType)}
            </button>
          )}

          <button
            type="button"
            onClick={handleLogout}
            className="text-sm text-slate-400 transition hover:text-slate-600"
          >
            Forgot PIN?
          </button>
        </div>
      </div>
    </div>
  );
};

export default PinLockScreen;
