import {
  Gauge,
  Moon,
  Radio,
  RotateCcw,
  Type,
} from 'lucide-react'
import { StatusPill } from '../components/StatusPill'
import {
  FOLLOW_CHECK_INTERVAL_OPTIONS,
  SAMPLE_DURATION_OPTIONS,
  updateSettings,
  useSettings,
} from '../features/settings/settingsStore'

export function SettingsRoute() {
  const settings = useSettings()

  return (
    <section className="settings-screen">
      <div className="section-heading">
        <StatusPill label="识曲已连接" tone="ready" />
        <h1>设置</h1>
      </div>

      <div className="settings-group">
        <div className="settings-row">
          <span className="settings-icon">
            <Radio size={24} aria-hidden="true" />
          </span>
          <div>
            <strong>自动跟唱</strong>
            <span>开启后会持续检查下一首歌</span>
          </div>
          <label className="switch">
            <input
              checked={settings.autoFollowEnabled}
              type="checkbox"
              onChange={(event) => updateSettings({ autoFollowEnabled: event.target.checked })}
            />
            <span />
          </label>
        </div>

        <div className="settings-row">
          <span className="settings-icon">
            <Type size={24} aria-hidden="true" />
          </span>
          <div>
            <strong>歌词字号</strong>
            <span>{settings.fontScale.toFixed(1)} 倍</span>
          </div>
          <div className="stepper">
            <button
              type="button"
              onClick={() => updateSettings({ fontScale: Math.max(0.8, settings.fontScale - 0.1) })}
            >
              -
            </button>
            <button
              type="button"
              onClick={() => updateSettings({ fontScale: Math.min(1.4, settings.fontScale + 0.1) })}
            >
              +
            </button>
          </div>
        </div>

        <div className="settings-row">
          <span className="settings-icon">
            <Gauge size={24} aria-hidden="true" />
          </span>
          <div>
            <strong>采样时长</strong>
            <span>{settings.sampleDurationSec} 秒</span>
          </div>
          <div className="segmented-control">
            {SAMPLE_DURATION_OPTIONS.map((value) => (
              <button
                className={settings.sampleDurationSec === value ? 'selected' : ''}
                key={value}
                type="button"
                onClick={() => updateSettings({ sampleDurationSec: value })}
              >
                {value}s
              </button>
            ))}
          </div>
        </div>

        <div className="settings-row">
          <span className="settings-icon">
            <Moon size={24} aria-hidden="true" />
          </span>
          <div>
            <strong>兜底检查</strong>
            <span>没有歌曲时长时每 {settings.followCheckIntervalSec} 秒检查</span>
          </div>
          <div className="segmented-control">
            {FOLLOW_CHECK_INTERVAL_OPTIONS.map((value) => (
              <button
                className={settings.followCheckIntervalSec === value ? 'selected' : ''}
                key={value}
                type="button"
                onClick={() => updateSettings({ followCheckIntervalSec: value })}
              >
                {value}s
              </button>
            ))}
          </div>
        </div>
      </div>

      <button
        className="reset-button"
        type="button"
        onClick={() =>
          updateSettings({
            sampleDurationSec: 8,
            autoFollowEnabled: true,
            followCheckIntervalSec: 90,
            fontScale: 1,
            keepScreenAwake: true,
          })
        }
      >
        <RotateCcw size={22} aria-hidden="true" />
        恢复默认
      </button>
    </section>
  )
}
