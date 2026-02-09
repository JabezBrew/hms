import Settings from 'lucide-react/dist/esm/icons/settings.js'
import LogOut from 'lucide-react/dist/esm/icons/log-out.js'
import UserCircle from 'lucide-react/dist/esm/icons/circle-user.js'
import * as React from 'react'

import { Button } from '@/components/ui/button'
import { SidebarTrigger } from '@/components/ui/sidebar'
import { useAuth } from '@/lib/auth'
import { ThemeToggle } from '../theme-toggle'
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
import { useOmniSearch } from '@/shared/components/omni-search/OmniSearchProvider'

import NotificationCenter from "./NotificationCenter"

export function OmniBar() {
    const { user, logout } = useAuth()
    const navigate = useNavigate()
    const { openDialog } = useOmniSearch()

    const handleLogout = async () => {
        await logout()
    }

    return (
        <header className="fixed top-0 left-0 right-0 z-50 w-full border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 h-16 flex items-center px-4 gap-4">
            <SidebarTrigger />

            <div className="flex-1 flex items-center max-w-2xl">
                <Button
                    variant="outline"
                    className="relative h-9 w-full justify-start rounded-[0.5rem] bg-muted/50 text-sm font-normal text-muted-foreground shadow-none sm:pr-12 md:w-full lg:w-[400px]"
                    onClick={openDialog}
                >
                    <span className="hidden lg:inline-flex">Search patients, pages, or actions...</span>
                    <span className="inline-flex lg:hidden">Search...</span>
                    <kbd className="pointer-events-none absolute right-[0.3rem] top-[0.3rem] hidden h-5 select-none items-center gap-1 rounded border bg-muted px-1.5 font-mono text-[10px] font-medium opacity-100 sm:flex">
                        <span className="text-xs">⌘</span>K
                    </kbd>
                </Button>
            </div>

            <div className="ml-auto flex items-center space-x-4">
                {/* Unified notification center */}
                <NotificationCenter />

                <FacilitySwitcher />

                <ThemeToggle />

                <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                        <Button variant="ghost" className="relative h-8 w-8 rounded-full">
                            <UserCircle className="h-6 w-6" />
                        </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent className="w-56" align="end" forceMount>
                        <DropdownMenuLabel className="font-normal">
                            <div className="flex flex-col space-y-1">
                                <p className="font-display text-sm leading-none">
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
                        <DropdownMenuItem onClick={() => navigate('/settings')}>
                            <Settings className="mr-2 h-4 w-4" />
                            <span>Settings</span>
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={handleLogout}>
                            <LogOut className="mr-2 h-4 w-4" />
                            <span>Log out</span>
                        </DropdownMenuItem>
                    </DropdownMenuContent>
                </DropdownMenu>
            </div>
        </header>
    )
}
