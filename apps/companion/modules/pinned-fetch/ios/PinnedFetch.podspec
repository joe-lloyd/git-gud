require 'json'
package = JSON.parse(File.read(File.join(__dir__, '..', 'package.json')))
Pod::Spec.new do |s|
  s.name           = 'PinnedFetch'
  s.version        = package['version']
  s.summary        = 'Certificate-pinned HTTP + SSE for Git Gud companion'
  s.author         = 'Joe Lloyd'
  s.homepage       = 'https://github.com/joe-lloyd/git-gud'
  s.license        = 'MIT'
  s.platforms      = { :ios => '15.1' }
  s.source         = { git: '' }
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.source_files = '**/*.{h,m,swift}'
end
