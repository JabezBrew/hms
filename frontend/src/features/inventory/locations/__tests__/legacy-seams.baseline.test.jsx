import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { AuthContext } from '@/lib/auth/AuthContext';
import { userCanAccess } from '@/shared/lib/access';
import { SIDEBARS } from '@/app/routes/routeTypes';
import CurrentPage from '../StorageLocationDirectoryPage';
const hook = vi.hoisted(() => vi.fn(() => ({ data: { results: [], count: 0 }, isLoading: false, error: null, refetch: vi.fn() })));
vi.mock('@/features/inventory/hooks', () => ({ useStorageLocations: hook }));
vi.mock('@/components/inventory', async importOriginal => ({ ...await importOriginal(), LocationForm: () => null }));
const runtime=window.__HMS_RUNTIME_CONFIG__;
const user={id:'21212121-2121-4121-8121-000000000001',role:'doctor',adminAccess:{capabilities:['inventory.view','patient.demographics.view']},accessContext:{features:['inventory'],patient_visibility:['demographics']}};
beforeEach(()=>{window.__HMS_RUNTIME_CONFIG__={apiMode:'rust-v2'};hook.mockClear();});afterEach(()=>{cleanup();window.__HMS_RUNTIME_CONFIG__=runtime;});
async function route(){vi.resetModules();return (await import('@/features/inventory/routes')).inventoryRoutes.find(x=>x.path==='/inventory/locations');}
it('allows the real inventory view authority without inventing a role restriction',async()=>{expect(userCanAccess(user,await route())).toBe(true);});
it('does not let an inventory role substitute for real Rust view authority',async()=>{expect(userCanAccess({...user,role:'pharmacist',adminAccess:{capabilities:[]}},await route())).toBe(false);});
it('preserves the explicit Django inventory role route',async()=>{window.__HMS_RUNTIME_CONFIG__={apiMode:'django'};expect(userCanAccess({...user,role:'pharmacist',adminAccess:{capabilities:[]}},await route())).toBe(true);});
it('keeps the real-capability locations entry reachable from the global sidebar',async()=>{vi.resetModules();const{resolveSidebarSections}=await import('@/components/layout/sidebar');const sections=resolveSidebarSections({sidebar:SIDEBARS.GLOBAL,user,enabledFeatures:{inventory:true},inboxCount:0,location:{pathname:'/'},params:{}});const walk=items=>items.flatMap(x=>[x.href,...walk(x.children||[])]);expect(sections.flatMap(s=>walk(s.items))).toContain('/inventory/locations');});
it('guards the page before invoking any directory query when demographics authority is absent',()=>{render(<AuthContext.Provider value={{user:{...user,adminAccess:{capabilities:['inventory.view']},accessContext:{...user.accessContext,patient_visibility:[]}}}}><MemoryRouter><CurrentPage/></MemoryRouter></AuthContext.Provider>);expect(hook).not.toHaveBeenCalled();expect(screen.getByText('Storage location administration unavailable')).toBeInTheDocument();});

it('keeps other inventory siblings role-restricted for the capability-only actor',async()=>{vi.resetModules();const{resolveSidebarSections}=await import('@/components/layout/sidebar');for(const sidebar of[SIDEBARS.GLOBAL,SIDEBARS.INVENTORY]){const sections=resolveSidebarSections({sidebar,user,enabledFeatures:{inventory:true},inboxCount:0,location:{pathname:'/'},params:{}});const walk=items=>items.flatMap(x=>[x.href,...walk(x.children||[])]);const links=sections.flatMap(s=>walk(s.items)).filter(x=>x?.startsWith('/inventory'));expect(links).toEqual(['/inventory/locations']);}const{inventoryRoutes}=await import('@/features/inventory/routes');expect(inventoryRoutes.filter(x=>x.path!=='/inventory/locations').every(x=>!userCanAccess(user,x))).toBe(true);});
