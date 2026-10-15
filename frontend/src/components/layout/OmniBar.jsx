import Settings from 'lucide-react/dist/esm/icons/settings.js'
import LogOut from 'lucide-react/dist/esm/icons/log-out.js'
import UserCircle from 'lucide-react/dist/esm/icons/circle-user.js'
import Search from 'lucide-react/dist/esm/icons/search.js'

import { Button } from '@/components/ui/button'
import { SidebarTrigger } from '@/components/ui/sidebar'
import { useAuth } from '@/lib/auth'
import { ThemeToggle } from '../theme-toggle'
import { FacilitySwitcher } from './FacilitySwitcher'
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuGroup,
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

    const handleLogout = async () => {
        await logout()
    }

    return (
        <header className="fixed top-0 left-0 right-0 z-50 flex h-16 w-full items-center gap-2 border-b border-border bg-card px-3 sm:gap-4 sm:px-5">
            <SidebarTrigger />

            <div className="flex min-w-0 flex-1 items-center max-w-xl">
                <Button
                    variant="outline"
                    className="h-9 w-full min-w-9 justify-start gap-2 px-2 sm:px-3"
                    onClick={openDialog}
                    aria-label="Search patients, pages, or actions"
                    aria-keyshortcuts="Meta+K Control+K"
                >
                    <Search data-icon="inline-start" aria-hidden="true" />
                    <span className="hidden min-w-0 truncate text-muted-foreground lg:block">Search patients, pages, or actions…</span>
                    <span className="hidden min-w-0 truncate text-muted-foreground sm:block lg:hidden">Search…</span>
                    <kbd aria-hidden="true" className="pointer-events-none ml-auto hidden h-5 select-none items-center gap-1 rounded border border-border bg-muted px-1.5 font-mono text-[10px] text-muted-foreground sm:flex">
                        <span className="text-xs">⌘</span>K
                    </kbd>
                </Button>
            </div>

            <div className="ml-auto flex shrink-0 items-center gap-1 sm:gap-2">
                {/* Unified notification center */}
                <NotificationCenter />

                <FacilitySwitcher />

                <ThemeToggle />

                <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" aria-label="Account menu">
                            <UserCircle aria-hidden="true" />
                        </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent className="w-56" align="end" forceMount>
                        <DropdownMenuLabel className="font-normal">
                            <div className="flex flex-col gap-y-1">
                                <p className="text-sm font-medium leading-snug">
                                    {user?.firstName && user?.lastName
                                        ? `${user.firstName} ${user.lastName}`
                                        : user?.firstName || user?.lastName || "User"}
                                </p>
                                <p className="text-xs capitalize leading-snug text-muted-foreground">
                                    {user?.role?.replaceAll('_', ' ') || ""}
                                </p>
                            </div>
                        </DropdownMenuLabel>
                        <DropdownMenuSeparator />
                        <DropdownMenuGroup>
                            <DropdownMenuItem onClick={() => navigate('/settings')}>
                                <Settings aria-hidden="true" />
                                <span>Settings</span>
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={handleLogout}>
                                <LogOut aria-hidden="true" />
                                <span>Log out</span>
                            </DropdownMenuItem>
                        </DropdownMenuGroup>
                    </DropdownMenuContent>
                </DropdownMenu>
            </div>
        </header>
    )
}
