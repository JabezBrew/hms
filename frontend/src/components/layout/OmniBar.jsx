import Settings from 'lucide-react/dist/esm/icons/settings.js'
import LogOut from 'lucide-react/dist/esm/icons/log-out.js'
import UserCircle from 'lucide-react/dist/esm/icons/circle-user.js'
import Search from 'lucide-react/dist/esm/icons/search.js'
import Moon from 'lucide-react/dist/esm/icons/moon.js'
import Sun from 'lucide-react/dist/esm/icons/sun.js'

import { Button } from '@/components/ui/button'
import { SidebarTrigger } from '@/components/ui/sidebar'
import { useAuth } from '@/lib/auth'
import { ThemeToggle } from '../theme-toggle'
import { useTheme } from '../theme-provider'
import { FacilitySwitcher } from './FacilitySwitcher'
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { useNavigate } from "react-router-dom"
import { useOmniSearch } from '@/shared/components/omni-search/OmniSearchContext'

import NotificationCenter from "./NotificationCenter"

export function OmniBar() {
    const { user, logout } = useAuth()
    const navigate = useNavigate()
    const { openDialog } = useOmniSearch()
    const { theme, toggleTheme } = useTheme()
    const modifierKey = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl'

    const handleLogout = async () => {
        await logout()
    }

    return (
        <header data-app-header className="fixed inset-x-0 top-0 z-50 flex h-16 w-full items-center gap-2 border-b border-border bg-card px-3 sm:gap-4 sm:px-4">
            <div className="flex shrink-0 items-center gap-3 md:w-[calc(var(--sidebar-width)-1rem)]">
                <SidebarTrigger />
                <div className="hidden flex-col gap-0.5 md:flex">
                    <span className="text-sm font-semibold tracking-wide">HMS</span>
                    <span className="text-[11px] text-muted-foreground">Clinical workspace</span>
                </div>
            </div>

            <div className="flex min-w-0 flex-1 items-center md:max-w-lg">
                <Button
                    variant="outline"
                    className="relative h-10 w-full min-w-0 justify-start gap-2 rounded-lg border-border bg-background px-3 text-sm font-normal text-muted-foreground shadow-none sm:pr-16"
                    onClick={openDialog}
                    aria-label="Search patients, pages, or actions"
                >
                    <Search className="size-4 shrink-0" aria-hidden="true" />
                    <span className="hidden lg:inline-flex">Search patients, pages, or actions…</span>
                    <span className="inline-flex truncate lg:hidden">Search</span>
                    <kbd aria-hidden="true" className="pointer-events-none absolute right-2 hidden h-6 select-none items-center gap-1 rounded border border-border bg-card px-1.5 font-mono text-[10px] sm:flex">
                        <span>{modifierKey}</span>K
                    </kbd>
                </Button>
            </div>

            <div className="ml-auto flex shrink-0 items-center gap-0.5 sm:gap-1.5">
                {/* Unified notification center */}
                <NotificationCenter />

                <FacilitySwitcher />

                <div className="hidden sm:block"><ThemeToggle /></div>

                <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" className="relative size-10 rounded-full" aria-label="Account menu">
                            <UserCircle className="size-5" aria-hidden="true" />
                        </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent className="w-56" align="end" forceMount>
                        <DropdownMenuLabel className="font-normal">
                            <div className="flex flex-col gap-y-1">
                                <p className="text-sm font-semibold leading-none">
                                    {user?.firstName && user?.lastName
                                        ? `${user.firstName} ${user.lastName}`
                                        : user?.firstName || user?.lastName || "User"}
                                </p>
                                <p className="font-mono text-[10px] leading-none text-muted-foreground uppercase tracking-wide">
                                    {user?.role || ""}
                                </p>
                            </div>
                        </DropdownMenuLabel>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem className="sm:hidden" onClick={toggleTheme}>
                            {theme === 'light' ? <Moon className="mr-2 size-4" /> : <Sun className="mr-2 size-4" />}
                            <span>Switch to {theme === 'light' ? 'dark' : 'light'} mode</span>
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => navigate('/settings')}>
                            <Settings className="mr-2 size-4" />
                            <span>Settings</span>
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={handleLogout}>
                            <LogOut className="mr-2 size-4" />
                            <span>Log out</span>
                        </DropdownMenuItem>
                    </DropdownMenuContent>
                </DropdownMenu>
            </div>
        </header>
    )
}
