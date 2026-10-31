import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { adaptV2AuthTokenResponse } from '@/lib/api/auth';
import { providerUser } from '@/features/auth/providerUser';
import { token } from '@/features/auth/__tests__/fixtures';
import { AuthContext } from '@/lib/auth/AuthContext';
import { RoleBasedRoute } from '@/components/auth/RoleBasedRoute';
import { userCanAccess } from '@/shared/lib/access';
import { canReadTransferList } from '../access';
import { SIDEBARS } from '@/app/routes/routeTypes';
const runtime=window.__HMS_RUNTIME_CONFIG__;
let user;
beforeEach(()=>{ window.__HMS_RUNTIME_CONFIG__={apiMode:'rust-v2'}; user=providerUser(adaptV2AuthTokenResponse({data:token(null,{permissions:['inventory.view','inventory.manage','patient.demographics.view','system.deployment_capabilities.view'],features:['inventory'],patient_visibility:['demographics']})})); });
afterEach(()=>{cleanup();window.__HMS_RUNTIME_CONFIG__=runtime;});
async function routes(){ vi.resetModules();return(await import('@/features/inventory/routes')).inventoryRoutes; }
it('actual ordinary adapted manager reaches the configured transfer route without Admin inflation',async()=>{expect(user.role).toBe('doctor');expect(user.accessContext.auth_security.privileged_user).toBe(false);const route=(await routes()).find(row=>row.path==='/inventory/transfers');expect(userCanAccess(user,route)).toBe(true);});
it('the actual RoleBasedRoute accepts the real configured transfer authority',async()=>{const route=(await routes()).find(row=>row.path==='/inventory/transfers');render(<AuthContext.Provider value={{user,isAuthenticated:true}}><MemoryRouter initialEntries={['/inventory/transfers']}><Routes><Route path='/inventory/transfers' element={<RoleBasedRoute allowedRoles={route.roles} allowedCapabilities={route.capabilities}><h1>Authorized configured transfer destination</h1></RoleBasedRoute>}/><Route path='/unauthorized' element={<h1>Transfer destination denied</h1>}/></Routes></MemoryRouter></AuthContext.Provider>);expect(screen.getByRole('heading',{name:'Authorized configured transfer destination'})).toBeInTheDocument();});
it('actual global and inventory sidebar expose the same transfer entry for the adapted ordinary manager',async()=>{vi.resetModules();const{resolveSidebarSections}=await import('@/components/layout/sidebar');const walk=rows=>rows.flatMap(row=>[row.href,...walk(row.children||[])]);for(const sidebar of[SIDEBARS.GLOBAL,SIDEBARS.INVENTORY]){const sections=resolveSidebarSections({sidebar,user,enabledFeatures:{inventory:true},inboxCount:0,location:{pathname:'/inventory/catalog'},params:{}});expect(sections.flatMap(section=>walk(section.items))).toContain('/inventory/transfers');}});
it('independent positive: the same actual adapted manager already reaches the catalog route',async()=>{const route=(await routes()).find(row=>row.path==='/inventory/catalog/*');expect(userCanAccess(user,route)).toBe(true);});
it('independent positive: Django pharmacist role keeps its existing transfer route',async()=>{window.__HMS_RUNTIME_CONFIG__={apiMode:'django'};const route=(await routes()).find(row=>row.path==='/inventory/transfers');expect(userCanAccess({role:'pharmacist'},route)).toBe(true);});
it('independent denial: an unrelated ordinary account has no transfer authority',async()=>{const route=(await routes()).find(row=>row.path==='/inventory/transfers');expect(userCanAccess({...user,adminAccess:{capabilities:[]}},route)).toBe(false);});

it.each(['inventory.view','inventory.manage','pharmacy.dispense','controlled_substance.manage'])('preserves existing %s list audience without inventing DemographicsView or management authority',async permission=>{
 for(const feature of ['inventory','pharmacy']){
  const reader=providerUser(adaptV2AuthTokenResponse({data:token(null,{permissions:[permission,'system.deployment_capabilities.view'],features:[feature],patient_visibility:['demographics']})}));
  expect(reader.role).not.toBe('admin');expect(canReadTransferList(reader)).toBe(true);const route=(await routes()).find(row=>row.path==='/inventory/transfers');expect(userCanAccess(reader,route)).toBe(true);expect(route.features).toBeUndefined();
  const{resolveSidebarSections}=await import('@/components/layout/sidebar');const walk=rows=>rows.flatMap(row=>[row.href,...walk(row.children||[])]);for(const sidebar of[SIDEBARS.GLOBAL,SIDEBARS.INVENTORY]){const sections=resolveSidebarSections({sidebar,user:reader,enabledFeatures:{[feature]:true},inboxCount:0,location:{pathname:'/'},params:{}});const links=sections.flatMap(section=>walk(section.items));expect(links).toContain('/inventory/transfers');if(feature==='pharmacy')expect(links.filter(link=>link?.startsWith('/inventory'))).toEqual(['/inventory/transfers']);}
 }
});
it.each(['permission','feature','visibility','facility'])('rejects missing real list %s even with an Admin label',missing=>{const denied=structuredClone(user);denied.role='admin';if(missing==='permission')denied.adminAccess.capabilities=[];if(missing==='feature')denied.accessContext.features=[];if(missing==='visibility')denied.accessContext.patient_visibility=[];if(missing==='facility')denied.accessContext.facility_id=null;expect(canReadTransferList(denied)).toBe(false);});
it('Django role restrictions still deny a Doctor with InventoryView alone',async()=>{window.__HMS_RUNTIME_CONFIG__={apiMode:'django'};const route=(await routes()).find(row=>row.path==='/inventory/transfers');expect(userCanAccess(user,route)).toBe(false);});
