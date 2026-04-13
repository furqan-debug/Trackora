import { useState, useRef, useEffect, useCallback } from 'react';
import { Star, LogOut, Menu, ChevronDown, User as UserIcon, LayoutGrid } from 'lucide-react';
import clsx from 'clsx';
import { useLocation, useNavigate, Link } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useFavorites } from '../context/FavoritesContext';
import { navStructure, matchActive, type Role } from '../nav/navModel';
import { useAuth } from '../context/AuthContext';
import { SecureImage } from './ui/SecureImage';

export interface HeaderProps {
    onOpenMobileMenu?: () => void;
}

export function Header({ onOpenMobileMenu }: HeaderProps) {
    const location = useLocation();
    const navigate = useNavigate();
    const { favorites, toggleFavorite, isFavorite } = useFavorites();
    const { profile, user } = useAuth();
    const [showProfileMenu, setShowProfileMenu] = useState(false);
    const [activeDropdown, setActiveDropdown] = useState<string | null>(null);
    const [showFavoritesDropdown, setShowFavoritesDropdown] = useState(false);
    
    const menuRef = useRef<HTMLDivElement>(null);
    const dropdownRef = useRef<HTMLDivElement>(null);
    const userRole = (profile?.role || 'User') as Role;

    const closeAll = useCallback(() => {
        setShowProfileMenu(false);
        setActiveDropdown(null);
        setShowFavoritesDropdown(false);
    }, []);

    useEffect(() => {
        function handleClickOutside(event: MouseEvent) {
            if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
                setShowProfileMenu(false);
            }
            if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
                setActiveDropdown(null);
                setShowFavoritesDropdown(false);
            }
        }
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    useEffect(() => {
        closeAll();
    }, [location.pathname, closeAll]);

    const handleLogout = async () => {
        await supabase.auth.signOut();
        navigate('/login');
    };

    const filteredNav = navStructure.filter(group => {
        if (group.allowedRoles && !group.allowedRoles.includes(userRole)) return false;
        return true;
    });

    return (
        <header className="h-16 md:h-20 glass-header border-b border-black/[0.05] flex items-center justify-between px-4 md:px-8 shrink-0 sticky top-0 z-[60] w-full backdrop-blur-3xl bg-white/70">
            {/* Left: Logo & Mobile Toggle */}
            <div className="flex items-center gap-4 lg:gap-8">
                {onOpenMobileMenu && (
                    <button
                        type="button"
                        onClick={onOpenMobileMenu}
                        className="md:hidden p-2 rounded-2xl text-text-secondary hover:text-text-primary hover:bg-black/[0.03] transition-all"
                        aria-label="Open menu"
                    >
                        <Menu className="w-6 h-6" strokeWidth={2.5} />
                    </button>
                )}

                <Link to="/dashboard" className="flex items-center gap-3 group">
                    <div className="w-8 h-8 md:w-10 md:h-10 rounded-xl bg-primary flex items-center justify-center text-white shadow-lg shadow-primary/20 group-hover:scale-105 transition-transform">
                         <div className="w-4 h-4 md:w-5 md:h-5 border-[2.5px] border-white rounded-[2px] rotate-45" />
                    </div>
                    <div className="hidden sm:flex flex-col">
                        <span className="text-lg md:text-xl font-bold text-text-primary tracking-tight leading-none">Trackora</span>
                        <span className="text-[9px] font-bold text-text-muted uppercase tracking-[0.2em] opacity-60">Admin Portal</span>
                    </div>
                </Link>
            </div>

            {/* Middle: Desktop Navigation */}
            <nav className="hidden md:flex items-center gap-1 lg:gap-2 px-4 py-1 rounded-2xl bg-black/[0.02] border border-black/[0.03]" ref={dropdownRef}>
                {filteredNav.map((group) => {
                    const hasChildren = group.children && group.children.length > 0;
                    const isActive = group.path ? matchActive(location.pathname, group.path) : group.children?.some(c => matchActive(location.pathname, c.path));
                    const isDropdownOpen = activeDropdown === group.name;

                    return (
                        <div key={group.name} className="relative">
                            {hasChildren ? (
                                <button
                                    onMouseEnter={() => setActiveDropdown(group.name)}
                                    className={clsx(
                                        "flex items-center gap-2 px-4 py-2 rounded-xl text-[13px] font-bold transition-all",
                                        isActive ? "text-primary bg-primary/5" : "text-text-secondary hover:text-text-primary hover:bg-black/[0.03]",
                                        isDropdownOpen && "bg-black/[0.03]"
                                    )}
                                >
                                    {group.name}
                                    <ChevronDown className={clsx("w-3.5 h-3.5 transition-transform duration-300", isDropdownOpen && "rotate-180")} />
                                </button>
                            ) : (
                                <Link
                                    to={group.path!}
                                    onMouseEnter={() => setActiveDropdown(null)}
                                    className={clsx(
                                        "px-4 py-2 rounded-xl text-[13px] font-bold transition-all whitespace-nowrap",
                                        isActive ? "text-primary bg-primary/5" : "text-text-secondary hover:text-text-primary hover:bg-black/[0.03]"
                                    )}
                                >
                                    {group.name}
                                </Link>
                            )}

                            {hasChildren && isDropdownOpen && (
                                <div 
                                    className="absolute top-full left-0 mt-2 w-56 p-2 bg-white/95 backdrop-blur-2xl border border-black/[0.08] rounded-2xl shadow-2xl animate-in fade-in slide-in-from-top-2 duration-200 z-50"
                                    onMouseLeave={() => setActiveDropdown(null)}
                                >
                                    {group.children!.map((child) => (
                                        <Link
                                            key={child.path}
                                            to={child.path}
                                            className={clsx(
                                                "block px-4 py-2.5 rounded-xl text-[13px] font-medium transition-all",
                                                matchActive(location.pathname, child.path)
                                                    ? "bg-primary text-white shadow-sm"
                                                    : "text-text-secondary hover:text-text-primary hover:bg-black/[0.03]"
                                            )}
                                        >
                                            {child.name}
                                        </Link>
                                    ))}
                                </div>
                            )}
                        </div>
                    );
                })}

                {/* Favorites Trigger (Desktop) */}
                <div className="relative border-l border-black/[0.05] ml-2 pl-2">
                    <button
                        onMouseEnter={() => {
                            setActiveDropdown(null);
                            setShowFavoritesDropdown(true);
                        }}
                        className={clsx(
                            "p-2 rounded-xl transition-all",
                            showFavoritesDropdown ? "bg-amber-400/10 text-amber-500" : "text-text-muted hover:text-amber-500 hover:bg-amber-400/5"
                        )}
                        aria-label="Favorites"
                    >
                        <Star className={clsx("w-4.5 h-4.5 transition-all", favorites.length > 0 && "fill-amber-400 text-amber-400")} />
                    </button>

                    {showFavoritesDropdown && (
                        <div 
                            className="absolute top-full right-0 mt-2 w-64 p-3 bg-white/95 backdrop-blur-2xl border border-black/[0.08] rounded-2xl shadow-2xl animate-in fade-in slide-in-from-top-2 duration-200 z-50"
                            onMouseLeave={() => setShowFavoritesDropdown(false)}
                        >
                            <div className="px-3 pb-2 mb-2 border-b border-black/[0.05]">
                                <p className="text-[10px] font-bold text-text-muted uppercase tracking-widest">Quick Access</p>
                            </div>
                            {favorites.length > 0 ? (
                                <div className="space-y-1">
                                    {favorites.map((fav) => (
                                        <Link
                                            key={fav.path}
                                            to={fav.path}
                                            className="flex items-center gap-3 px-3 py-2 rounded-xl text-[13px] font-medium text-text-secondary hover:text-primary hover:bg-primary/5 transition-all group"
                                        >
                                            <div className="w-1.5 h-1.5 rounded-full bg-primary/40 group-hover:bg-primary" />
                                            {fav.name}
                                        </Link>
                                    ))}
                                </div>
                            ) : (
                                <p className="px-3 py-4 text-[12px] text-text-muted italic text-center">No favorites yet</p>
                            )}
                        </div>
                    )}
                </div>
            </nav>

            {/* Right: Profile & Actions */}
            <div className="flex items-center gap-3 md:gap-4" ref={menuRef}>
                <div className="relative">
                    <button
                        type="button"
                        onClick={() => setShowProfileMenu((v) => !v)}
                        className="group flex items-center gap-3 p-1 rounded-2xl bg-black/[0.03] border border-black/[0.05] hover:border-primary/30 hover:bg-white transition-all shadow-sm"
                        aria-expanded={showProfileMenu}
                    >
                        <div className="w-8 h-8 md:w-9 md:h-9 rounded-xl bg-gradient-to-br from-primary to-blue-600 flex items-center justify-center text-white text-[13px] font-bold shadow-lg shadow-primary/20 group-hover:scale-105 transition-transform uppercase overflow-hidden">
                            {profile?.avatar_url ? (
                                <SecureImage 
                                    path={profile.avatar_url} 
                                    bucket="avatars" 
                                    alt="" 
                                    className="w-full h-full object-cover" 
                                />
                            ) : (
                                profile?.full_name?.charAt(0) || user?.email?.charAt(0) || '?'
                            )}
                        </div>
                        <div className="hidden sm:block text-left pr-3">
                           <p className="text-[13px] font-bold text-text-primary leading-none mb-1 tracking-tight">{profile?.full_name?.split(' ')[0] || 'User'}</p>
                           <div className="flex items-center gap-1">
                               <span className="text-[9px] font-bold text-emerald-500 uppercase tracking-widest opacity-80">Available</span>
                               <ChevronDown className={clsx("w-3 h-3 text-text-muted transition-transform duration-300", showProfileMenu && "rotate-180")} />
                           </div>
                        </div>
                    </button>

                    {showProfileMenu && (
                        <div
                            className="absolute right-0 top-full mt-3 w-72 bg-white/95 backdrop-blur-2xl border border-black/[0.08] rounded-3xl shadow-2xl py-2 z-[70] animate-in fade-in zoom-in-95 duration-200 origin-top-right"
                        >
                            <div className="px-6 py-5 border-b border-black/[0.05]">
                                <p className="text-[15px] font-bold text-text-primary truncate tracking-tight mb-1">{profile?.full_name || 'No Name'}</p>
                                <p className="text-[11px] text-text-muted font-bold truncate opacity-70 font-mono">{profile?.email || user?.email}</p>
                                <div className="mt-4 flex items-center gap-2">
                                    <span className="px-3 py-1 rounded-xl bg-primary/5 text-primary text-[10px] font-bold uppercase tracking-widest border border-primary/10">
                                        Role: {profile?.role || 'User'}
                                    </span>
                                </div>
                            </div>
                            
                            <div className="p-2">
                                <Link
                                    to="/dashboard/profile"
                                    className="w-full flex items-center gap-4 px-4 py-3 text-[13px] font-bold text-text-primary hover:bg-black/[0.03] rounded-2xl transition-all group"
                                >
                                    <div className="w-9 h-9 rounded-xl bg-primary/5 flex items-center justify-center text-primary group-hover:bg-primary group-hover:text-white transition-all">
                                        <UserIcon className="w-4.5 h-4.5" />
                                    </div>
                                    My Profile
                                </Link>

                                <button
                                    onClick={handleLogout}
                                    className="w-full flex items-center gap-4 px-4 py-3 text-[13px] font-bold text-rose-500 hover:bg-rose-500/5 rounded-2xl transition-all group"
                                >
                                    <div className="w-9 h-9 rounded-xl bg-rose-500/5 flex items-center justify-center group-hover:bg-rose-500 group-hover:text-white transition-all">
                                        <LogOut className="w-4.5 h-4.5" />
                                    </div>
                                    Sign Out
                                </button>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </header>
    );
}
