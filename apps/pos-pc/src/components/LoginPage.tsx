import React, { useState, useEffect } from 'react';
import { 
  LogIn, 
  Mail, 
  Lock, 
  Croissant,
  Eye,
  EyeOff,
  Store
} from 'lucide-react';
import { signInWithEmailAndPassword, onAuthStateChanged, signOut, User } from 'firebase/auth';
import { auth } from '../config/firebase';

interface LoginPageProps {
  onLogin: (user: User) => void;
  accessError?: string;
}

export function LoginPage({ onLogin, accessError }: LoginPageProps) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const result = await signInWithEmailAndPassword(auth, email, password);
      onLogin(result.user);
    } catch (err: any) {
      setError(err.code === 'auth/invalid-credential' 
        ? 'Email o contraseña incorrectos' 
        : err.code === 'auth/too-many-requests'
        ? 'Demasiados intentos. Esperá unos minutos.'
        : 'Error al iniciar sesión');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#FDFBF7] dark:bg-zinc-950 p-4">
      <div className="w-full max-w-md">
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-20 h-20 rounded-2xl bg-amber-500/10 mb-4">
            <Croissant className="w-10 h-10 text-amber-500" />
          </div>
          <h1 className="text-2xl font-bold text-amber-700 dark:text-amber-450 font-serif">
            El Rey De Las Medialunas
          </h1>
          <p className="text-sm text-gray-500 dark:text-zinc-400 mt-1">
            Sistema de Gestión
          </p>
        </div>

        {/* Login Card */}
        <div className="bg-white dark:bg-zinc-900 border border-orange-100/30 dark:border-zinc-800 rounded-2xl p-6 shadow-sm">
          <div className="flex items-center gap-2 mb-6">
            <Store className="w-5 h-5 text-amber-500" />
            <h2 className="text-lg font-bold text-gray-800 dark:text-zinc-100">
              Iniciar Sesión
            </h2>
          </div>

          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <label className="block text-xs font-bold text-gray-500 dark:text-zinc-400 mb-1.5">
                Email
              </label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="cajero@panaderia.com"
                  required
                  className="w-full pl-10 pr-4 py-3 bg-gray-50 dark:bg-zinc-950 border border-gray-200 dark:border-zinc-800 rounded-xl text-sm text-gray-800 dark:text-zinc-100 placeholder:text-gray-400 focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500 transition-all"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-bold text-gray-500 dark:text-zinc-400 mb-1.5">
                Contraseña
              </label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  required
                  className="w-full pl-10 pr-10 py-3 bg-gray-50 dark:bg-zinc-950 border border-gray-200 dark:border-zinc-800 rounded-xl text-sm text-gray-800 dark:text-zinc-100 placeholder:text-gray-400 focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500 transition-all"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:hover:text-zinc-300"
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            {(error || accessError) && (
              <div className="bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-800/30 rounded-xl px-4 py-3 text-sm text-red-600 dark:text-red-400">
                {error || accessError}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full flex items-center justify-center gap-2 bg-amber-500 hover:bg-amber-600 text-white font-bold py-3 px-6 rounded-xl transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? (
                <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              ) : (
                <LogIn className="w-4 h-4" />
              )}
              {loading ? 'Ingresando...' : 'Ingresar'}
            </button>
          </form>
        </div>

        <p className="text-center text-xs text-gray-400 dark:text-zinc-500 mt-6">
          © 2026 El Rey De Las Medialunas · v0.1.0
        </p>
      </div>
    </div>
  );
}
