# FixItAll: Django + React Architecture Guide

This document outlines the transition to a Django-based backend for the FixItAll electronics store.

## Project Structure

The project is moving towards a decoupled architecture with a **React (Vite)** frontend and a **Django** backend.

### Backend Apps (Django)

1.  **`account`**: Manages user authentication, registration, and profiles.
    -   Uses Django REST Framework (DRF) for token-based auth.
    -   Handles permissions for Admin and Customer roles.

2.  **`eadmin`**: The administrative engine.
    -   Provides APIs for the `/admin` routes in the frontend.
    -   Manages inventory, orders, and user activity tracking.

3.  **`efrontend`**: The public storefront API.
    -   Serves product data, categories, and search results to the main store pages.
    -   Optimized for read-heavy operations.

## How to Connect Frontend and Backend

### 1. API Configuration
Create a service layer in React that mirrors the Django app structure:
- `src/api/accountService.ts` -> Connects to `account/`
- `src/api/adminService.ts` -> Connects to `eadmin/`
- `src/api/storeService.ts` -> Connects to `efrontend/`

### 2. Authentication Flow
- The frontend sends credentials to `/api/account/login/`.
- Django returns a JWT or sets a session cookie.
- Subsequent requests include the token in the `Authorization` header.

### 3. Database Connection
- **Django Models**: Define models in each app's `models.py`.
- **Migrations**: Use `python manage.py makemigrations` and `migrate` to sync the schema.
- **Frontend Data**: The frontend receives JSON responses and maps them to the existing TypeScript interfaces (e.g., `Product`, `UserActivity`).

## Instructions for Future AI Development

When adding new features:
1.  **Backend First**: Implement the model and the DRF Serializer/View in the appropriate Django app (`account`, `eadmin`, or `efrontend`).
2.  **API Documentation**: Ensure the endpoint is documented or follows standard REST patterns.
3.  **Frontend Update**: Update the corresponding React component to fetch data from the new Django endpoint instead of Firebase or static files.
4.  **Type Safety**: Update `src/types.ts` if the backend data structure changes.
