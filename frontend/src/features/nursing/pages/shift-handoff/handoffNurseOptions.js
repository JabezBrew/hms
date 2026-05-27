import { normalizeApiResults } from '@/lib/utils';

function getCurrentUserDisplayName(user) {
  return [user?.firstName, user?.lastName].filter(Boolean).join(' ').trim()
    || user?.email
    || 'Current User';
}

export function getHandoffNurseOptions({ rustV2Mode, wardStaff = [], staff = [], currentUser = null }) {
  const assignedWardStaff = normalizeApiResults(wardStaff);
  if (!rustV2Mode || assignedWardStaff.length > 0) {
    return {
      nurses: assignedWardStaff,
      usesDirectoryFallback: false,
    };
  }

  const directoryNurses = normalizeApiResults(staff).reduce((nurses, member) => {
    if (member.is_active === false) {
      return nurses;
    }

    const nurse = {
      id: member.user_id || member.id,
      full_name: member.full_name || member.name || member.display_name || member.email,
      role_name: member.user_type ? member.user_type.replaceAll('_', ' ') : member.role_name || 'Staff',
    };
    if (nurse.id && nurse.full_name) {
      nurses.push(nurse);
    }
    return nurses;
  }, []);

  const currentUserFallback = currentUser?.id
    ? [{
      id: currentUser.id,
      full_name: getCurrentUserDisplayName(currentUser),
      role_name: currentUser.role || currentUser.user_type || 'Staff',
    }]
    : [];

  const fallbackNurses = directoryNurses.length > 0 ? directoryNurses : currentUserFallback;

  return {
    nurses: fallbackNurses,
    usesDirectoryFallback: fallbackNurses.length > 0,
  };
}
