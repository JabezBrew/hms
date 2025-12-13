import { toast } from "sonner";

/**
 * Notification utility functions for displaying toast messages
 */
export const notifications = {
  /**
   * Show a success notification
   * @param {string} message - The message to display
   * @param {Object} options - Additional options for the toast
   */
  success: (message, options = {}) => {
    toast.success(message, {
      duration: 3000,
      ...options,
    });
  },

  /**
   * Show an error notification
   * @param {string} message - The message to display
   * @param {Object} options - Additional options for the toast
   */
  error: (message, options = {}) => {
    toast.error(message, {
      duration: 5000,
      ...options,
    });
  },

  /**
   * Show an info notification
   * @param {string} message - The message to display
   * @param {Object} options - Additional options for the toast
   */
  info: (message, options = {}) => {
    toast.info(message, {
      duration: 3000,
      ...options,
    });
  },

  /**
   * Show a warning notification
   * @param {string} message - The message to display
   * @param {Object} options - Additional options for the toast
   */
  warning: (message, options = {}) => {
    toast.warning(message, {
      duration: 4000,
      ...options,
    });
  },

  /**
   * Show a loading notification that can be updated
   * @param {string} message - The message to display
   * @returns {Function} A function to update or dismiss the toast
   */
  loading: (message) => {
    const toastId = toast.loading(message);
    
    return {
      /**
       * Update the loading toast with a success message
       * @param {string} message - The success message
       */
      success: (message) => {
        toast.success(message, { id: toastId });
      },
      
      /**
       * Update the loading toast with an error message
       * @param {string} message - The error message
       */
      error: (message) => {
        toast.error(message, { id: toastId });
      },
      
      /**
       * Dismiss the loading toast
       */
      dismiss: () => {
        toast.dismiss(toastId);
      }
    };
  },

  /**
   * Show a notification with a custom action button
   * @param {string} message - The message to display
   * @param {string} actionLabel - The label for the action button
   * @param {Function} onAction - The function to call when the action button is clicked
   * @param {Object} options - Additional options for the toast
   */
  action: (message, actionLabel, onAction, options = {}) => {
    toast(message, {
      duration: 5000,
      action: {
        label: actionLabel,
        onClick: onAction,
      },
      ...options,
    });
  },
};