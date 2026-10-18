import { getDeviceId, getDeviceName } from '../platform/deviceInfo'
import { platform } from '../platform'
import { apiFetch } from './client'

export interface TokenResponse {
  token: string
  user_id: string
  username: string
  expires_in: number
}

export interface MeResponse {
  user_id: string
  username: string
  created_at_ms: number
}

function deviceFields() {
  return {
    device_id: getDeviceId(),
    device_name: getDeviceName(),
    platform,
  }
}

export function register(username: string, password: string) {
  return apiFetch<TokenResponse>('/api/auth/register', {
    method: 'POST',
    anonymous: true,
    body: { username, password, ...deviceFields() },
  })
}

export function login(username: string, password: string) {
  return apiFetch<TokenResponse>('/api/auth/login', {
    method: 'POST',
    anonymous: true,
    body: { username, password, ...deviceFields() },
  })
}

export function fetchMe() {
  return apiFetch<MeResponse>('/api/auth/me')
}
